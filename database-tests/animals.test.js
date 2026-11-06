import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const vet = '12345678-1234-4234-8234-123456789012';
const admin = '12345678-1234-4234-8234-123456789013';
const details = { chip_id: ' NEW_123 ', name: ' Buddy ', animal: 'Dog', species: 'Pug', age: '0', sex: 'M', notes: '' };
async function migrate(db, name) {
  await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create table public.animals(chip_id text primary key, name text, animal text, species text, age integer, sex text, notes text);
    create table public.treatments(id bigint generated always as identity primary key, chip_id text references public.animals(chip_id));
    insert into public.animals values ('LEGACY', 'Luna', 'Cat', 'Ragdoll', 2, 'F', 'Existing');
    grant select on public.animals to authenticated;
    create policy existing_read on public.animals for select to authenticated using(true);
  `);
  await migrate(db, '202611050001_registration.sql');
  await migrate(db, '202611060001_admin_patient_access.sql');
  await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [vet, 'vet@example.com', admin, 'admin@example.com']);
  await db.query("update public.profiles set approval_status='approved', role=case when id=$1 then 'admin' else 'veterinarian' end", [admin]);
  return db;
}
async function login(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
}
async function create(db, changes = {}) {
  return (await db.query('select * from public.create_animal($1::jsonb)', [JSON.stringify({ ...details, ...changes })])).rows[0];
}
test('animal migration generates stable unique IDs, validates input and enforces approval', async () => {
  const db = await fixture();
  try {
    await migrate(db, '202611060002_create_animals.sql');
    const legacy = (await db.query("select * from public.animals where chip_id='LEGACY'")).rows[0];
    assert.match(legacy.global_id, /^[0-9a-f-]{36}$/);
    assert.equal(legacy.notes, 'Existing');
    await login(db, vet);
    const record = await create(db);
    assert.equal(record.chip_id, 'NEW_123'); assert.equal(record.name, 'Buddy'); assert.equal(record.age, 0);
    assert.match(record.global_id, /^[0-9a-f-]{36}$/);
    assert.notEqual(record.global_id, legacy.global_id);
    await assert.rejects(create(db, { chip_id: 'new_123' }), { code: '23505' });
    await assert.rejects(create(db, { chip_id: ' new_123 ' }), { code: '23505' });
    for (const key of ['chip_id', 'name', 'animal', 'species']) {
      await assert.rejects(create(db, { chip_id: `bad_${key}`, [key]: '   ' }), { code: '23514' });
    }
    for (const age of ['-1', '1.5', 'not-age', '99999999999999999999']) await assert.rejects(create(db, { chip_id: `age_${age}`, age }));
    await assert.rejects(create(db, { chip_id: 'bad_sex', sex: 'X' }), { code: '23514' });
    await assert.rejects(create(db, { chip_id: 'bad_notes', notes: 'a'.repeat(5001) }), { code: '23514' });
    const concurrent = await Promise.allSettled([create(db, { chip_id: 'RACE' }), create(db, { chip_id: ' race ' })]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, '23505');
    const supplied = await create(db, { chip_id: 'SECOND', global_id: record.global_id });
    assert.notEqual(supplied.global_id, record.global_id);
    await db.exec('reset role');
    await assert.rejects(db.query("update public.animals set global_id=gen_random_uuid() where chip_id='NEW_123'"), { code: '23514' });
    await db.query("update public.animals set notes='Updated notes' where chip_id='NEW_123'");
    assert.equal((await db.query("select global_id from public.animals where chip_id='NEW_123'")).rows[0].global_id, record.global_id);
    await login(db, admin);
    assert.ok((await create(db, { chip_id: 'ADMIN', age: '', sex: '' })).global_id);
    for (const status of ['pending', 'rejected']) {
      await db.exec('reset role');
      await db.query('update public.profiles set approval_status=$1 where id=$2', [status, vet]);
      await login(db, vet);
      await assert.rejects(create(db, { chip_id: `BLOCKED_${status}` }), { code: '42501' });
      await assert.rejects(db.query("insert into public.animals(chip_id,name,animal,species) values('BYPASS','Name','Dog','Pug')"), { code: '42501' });
      assert.equal((await db.query('select * from public.animals')).rows.length, 0);
    }
    await db.exec('reset role; set role anon');
    await assert.rejects(create(db, { chip_id: 'ANON' }), { code: '42501' });
  } finally { await db.close(); }
});
test('migration refuses legacy duplicates without merging or changing existing animals', async () => {
  const db = await fixture();
  try {
    await db.exec("insert into public.animals(chip_id,name) values (' legacy ', 'Duplicate')");
    await assert.rejects(migrate(db, '202611060002_create_animals.sql'), /Duplicate Chip IDs exist/);
    await db.exec('rollback');
    assert.equal((await db.query('select * from public.animals')).rows.length, 2);
    assert.equal((await db.query("select column_name from information_schema.columns where table_name='animals' and column_name='global_id'")).rows.length, 0);
  } finally { await db.close(); }
});
