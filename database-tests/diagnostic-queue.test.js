
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  admin: "12345678-1234-4234-8234-000000000001",
  vet: "12345678-1234-4234-8234-000000000002",
  staffA: "12345678-1234-4234-8234-000000000003",
  staffB: "12345678-1234-4234-8234-000000000004",
};

async function login(db, id) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [id]
  );
  await db.exec("set role authenticated");
}

async function rpc(db, name, args = []) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
  return (
    await db.query(
      `select * from public.${name}(${placeholders})`,
      args
    )
  ).rows[0];
}

async function setup() {
  const db = new PGlite();

  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;

    create function auth.uid()
    returns uuid language sql stable as $$
      select nullif(
        current_setting('request.jwt.claim.sub', true), ''
      )::uuid
    $$;

    grant usage on schema auth to anon, authenticated;

    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'
    );

    create table public.animals (
      chip_id text primary key,
      name text,
      animal text,
      species text,
      age integer,
      sex text,
      notes text
    );

    create table public.treatments (
      id bigint generated always as identity primary key,
      chip_id text references public.animals(chip_id)
    );

    grant select on public.animals to authenticated;
    create policy existing_read
      on public.animals for select
      to authenticated using (true);

    insert into public.animals
    values ('TEST', 'Mochi', 'Cat', 'Shorthair', 3, 'F', '');
  `);

  const migrations = [
    "202611050001_registration.sql",
    "202611060001_admin_patient_access.sql",
    "202611060002_create_animals.sql",
    "202611060003_medication_orders.sql",
    "202611060004_cancel_medication_orders.sql",
    "202611060005_pharmacy_fulfillment.sql",
    "202611060006_diagnostic_center_accounts.sql",
    "202611060007_diagnostic_queue.sql",
  ];

  for (const name of migrations) {
    const sql = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      "utf8"
    );
    await db.exec(sql);
  }

  for (const [name, id] of Object.entries(ids)) {
    const accountType = name.startsWith("staff")
      ? "diagnostic_staff"
      : "veterinarian";

    await db.query(
      `insert into auth.users(id, email, raw_user_meta_data)
       values ($1, $2, $3)`,
      [
        id,
        `${name}@example.com`,
        JSON.stringify({ account_type: accountType }),
      ]
    );
  }

  await db.query(
    `update public.profiles
     set role = 'admin', approval_status = 'approved'
     where id = $1`,
    [ids.admin]
  );

  await db.query(
    `update public.profiles
     set approval_status = 'approved'
     where id = $1`,
    [ids.vet]
  );

  const animalId = (
    await db.query(
      "select global_id from public.animals where chip_id = 'TEST'"
    )
  ).rows[0].global_id;

  await login(db, ids.admin);

  const centerA = (
    await rpc(db, "save_diagnostic_center", [
      "Central Diagnostics", null, "approved"
    ])
  ).save_diagnostic_center;

  const centerB = (
    await rpc(db, "save_diagnostic_center", [
      "West Diagnostics", null, "approved"
    ])
  ).save_diagnostic_center;

  await rpc(db, "assign_diagnostic_center_member", [
    ids.staffA, centerA
  ]);

  await rpc(db, "assign_diagnostic_center_member", [
    ids.staffB, centerB
  ]);

  return { db, centerA, centerB, animalId };
}

test("diagnostic requests are isolated between centers", async () => {
  const { db, centerA, animalId } = await setup();

  try {
    await login(db, ids.vet);

    const requestId = (
      await db.query(
        `insert into public.diagnostic_requests
           (animal_global_id, assigned_center_id, test_name)
         values ($1, $2, $3)
         returning id`,
        [animalId, centerA, "Blood Panel"]
      )
    ).rows[0].id;

    await login(db, ids.staffA);

    const ownRequests = await db.query(
      "select * from public.diagnostic_requests"
    );

    assert.equal(ownRequests.rows.length, 1);

    await login(db, ids.staffB);

    const otherRequests = await db.query(
      "select * from public.diagnostic_requests"
    );

    assert.equal(otherRequests.rows.length, 0);

    await assert.rejects(
      rpc(db, "update_diagnostic_request", [
        requestId, "in_progress", null
      ]),
      { code: "42501" }
    );
  } finally {
    await db.close();
  }
});

test("diagnostic status workflow enforces valid transitions", async () => {
  const { db, centerA, animalId } = await setup();

  try {
    await login(db, ids.vet);

    const requestId = (
      await db.query(
        `insert into public.diagnostic_requests
           (animal_global_id, assigned_center_id, test_name)
         values ($1, $2, $3)
         returning id`,
        [animalId, centerA, "X-Ray"]
      )
    ).rows[0].id;

    await login(db, ids.staffA);

    await assert.rejects(
      rpc(db, "update_diagnostic_request", [
        requestId, "completed", null
      ]),
      { code: "22023" }
    );

    const started = await rpc(
      db, "update_diagnostic_request",
      [requestId, "in_progress", null]
    );

    assert.equal(started.status, "in_progress");

    await assert.rejects(
      rpc(db, "update_diagnostic_request", [
        requestId, "unable_to_complete", ""
      ]),
      { code: "22023" }
    );

    const finished = await rpc(
      db, "update_diagnostic_request",
      [requestId, "unable_to_complete", "Machine unavailable"]
    );

    assert.equal(finished.status, "unable_to_complete");
    assert.equal(finished.unable_reason, "Machine unavailable");

    await assert.rejects(
      rpc(db, "update_diagnostic_request", [
        requestId, "completed", null
      ]),
      { code: "22023" }
    );

    await assert.rejects(
      db.query(
        `update public.diagnostic_requests
         set status = 'completed'
         where id = $1`,
        [requestId]
      ),
      { code: "42501" }
    );
  } finally {
    await db.close();
  }
});
