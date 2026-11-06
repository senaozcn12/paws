import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const ids = Object.fromEntries(['vet','otherVet','admin','staff','otherStaff','colleague'].map((key,index) => [key, `12345678-1234-4234-8234-${String(index+1).padStart(12,'0')}`]));
const address = 'PAWS Clinic, Dr Vet, 123 Clinic Road, Chicago IL 60607';
async function login(db, user) {
  await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await db.exec('set role authenticated');
}
async function rpc(db, fn, args) {
  return (await db.query(`select * from public.${fn}(${args.map((_,i) => `$${i+1}`).join(',')})`,args)).rows[0];
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create table public.animals(chip_id text primary key,name text,animal text,species text,age integer,sex text,notes text);
    create table public.treatments(id bigint generated always as identity primary key,chip_id text references public.animals(chip_id));
    grant select on public.animals to authenticated;
    create policy existing_read on public.animals for select to authenticated using(true);
    insert into public.animals values('TEST','Buddy','Dog','Pug',3,'M','');`);
  for (const migration of ['202611050001_registration.sql','202611060001_admin_patient_access.sql','202611060002_create_animals.sql','202611060003_medication_orders.sql','202611060004_cancel_medication_orders.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8'));
  }
  for (const [key,id] of Object.entries(ids)) await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${key}@example.com`]);
  await db.exec("update public.profiles set approval_status='approved'");
  await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
  const animal = (await db.query('select global_id from public.animals')).rows[0].global_id;
  const legacy = (await db.query("insert into public.medication_orders(animal_global_id,medication_name,dosage,frequency,reason,prescriber_id) values($1,'Legacy medicine','Dose','Daily','Reason',$2) returning *",[animal,ids.vet])).rows[0];
  await db.exec(await readFile(new URL('../supabase/migrations/202611060005_pharmacy_fulfillment.sql',import.meta.url),'utf8'));
  await login(db,ids.admin);
  const p1 = (await rpc(db,'save_pharmacy',['Central Pharmacy',null,'approved'])).save_pharmacy;
  const p2 = (await rpc(db,'save_pharmacy',['West Pharmacy',null,'approved'])).save_pharmacy;
  await rpc(db,'assign_pharmacy_member',[ids.staff,p1]); await rpc(db,'assign_pharmacy_member',[ids.colleague,p1]); await rpc(db,'assign_pharmacy_member',[ids.otherStaff,p2]);
  return { db,animal,legacy,p1,p2 };
}
async function create(db, animal, pharmacy, changes={}) {
  const o = { animal_global_id:animal, medication_name:'Medicine',dosage:'Prescribed dose',frequency:'Daily',reason:'Vet reason',assigned_pharmacy_id:pharmacy,delivery_address:address,...changes };
  return (await db.query(`insert into public.medication_orders(${Object.keys(o).join(',')}) values(${Object.keys(o).map((_,i)=>`$${i+1}`).join(',')}) returning *`,Object.values(o))).rows[0];
}
const update = (db,o,status,extra={}) => rpc(db,'update_medication_fulfillment',[o.id,status,o.fulfillment_version,extra.carrier||'',extra.number||'',extra.url||'',extra.note||'']);
test('assigned pharmacy lifecycle, prescriber reassignment, tracking and audit preserve prescription', async () => {
  const {db,animal,legacy,p1,p2}=await fixture();
  try {
    await login(db,ids.vet);
    assert.equal((await db.query('select * from public.medication_orders where id=$1',[legacy.id])).rows[0].fulfillment_status,'unassigned');
    const routed = await rpc(db,'assign_medication_pharmacy',[legacy.id,p1,address,0]); assert.equal(routed.fulfillment_status,'awaiting_acceptance');
    let o=await create(db,animal,p1);
    assert.equal(o.pharmacy_name,'Central Pharmacy'); assert.equal(o.fulfillment_status,'awaiting_acceptance');
    await login(db,ids.otherVet);
    await assert.rejects(rpc(db,'assign_medication_pharmacy',[o.id,p2,address,0]),{code:'42501'});
    await login(db,ids.otherStaff);
    assert.equal((await db.query('select * from public.medication_orders')).rows.length,0);
    await assert.rejects(update(db,o,'processing'),{code:'42501'});
    await login(db,ids.staff);
    assert.equal((await db.query('select * from public.animals')).rows.length,0);
    await assert.rejects(db.query("update public.medication_orders set dosage='Changed' where id=$1",[o.id]),{code:'42501'});
    await assert.rejects(create(db,animal,p1),{code:'42501'});
    const original=o;
    o=await update(db,o,'processing'); assert.equal(o.fulfillment_version,1);
    await assert.rejects(update(db,original,'processing'),{code:'40001'});
    await login(db,ids.colleague);
    assert.equal((await db.query('select * from public.medication_orders where id=$1',[o.id])).rows.length,1);
    await login(db,ids.vet);
    await assert.rejects(rpc(db,'assign_medication_pharmacy',[o.id,p2,address,o.fulfillment_version]),{code:'22023'});
    await assert.rejects(rpc(db,'cancel_medication_order',[o.id]),{code:'22023'});
    await assert.rejects(update(db,o,'shipped',{carrier:'Carrier',number:'123'}),{code:'42501'});
    await login(db,ids.staff);
    await assert.rejects(update(db,o,'declined'),{code:'22023'});
    o=await update(db,o,'declined',{note:'Out of stock; released to prescriber'});
    await login(db,ids.vet);
    o=await rpc(db,'assign_medication_pharmacy',[o.id,p2,address,o.fulfillment_version]);
    assert.equal(o.pharmacy_name,'West Pharmacy');
    await login(db,ids.staff);
    assert.equal((await db.query('select * from public.medication_orders where id=$1',[o.id])).rows.length,0);
    assert.equal((await db.query('select * from public.medication_fulfillment_events where order_id=$1',[o.id])).rows.length,0);
    await login(db,ids.otherStaff);
    o=await update(db,o,'processing');
    await assert.rejects(update(db,o,'delivered',{carrier:'Carrier',number:'123'}),{code:'22023'});
    await assert.rejects(update(db,o,'shipped'),{code:'22023'});
    await assert.rejects(update(db,o,'shipped',{carrier:'Carrier',number:'123',url:'javascript:alert(1)'}),{code:'22023'});
    o=await update(db,o,'shipped',{carrier:'Carrier',number:'TRACK123',url:'https://tracking.example.com/TRACK123'});
    o=await update(db,o,'shipped',{carrier:'Carrier',number:'TRACK456',url:'https://tracking.example.com/TRACK456'});
    o=await update(db,o,'delivered',{carrier:o.carrier,number:o.tracking_number,url:o.tracking_url});
    assert.equal(o.order_status,'fulfilled');
    for(const key of ['medication_name','dosage','frequency','reason','prescriber_id','animal_global_id']) assert.equal(o[key],original[key]);
    await assert.rejects(update(db,o,'processing'),{code:'22023'});
    await login(db,ids.vet);
    const stored=(await db.query('select * from public.medication_orders where id=$1',[o.id])).rows[0];
    assert.equal(stored.tracking_number,'TRACK456'); assert.equal(stored.fulfillment_status,'delivered');
    const events=(await db.query('select * from public.medication_fulfillment_events where order_id=$1 order by id',[o.id])).rows;
    assert.equal(events.length,8); assert.equal(events[0].actor_id,ids.vet); assert.equal(events.at(-1).actor_id,ids.otherStaff);
    await assert.rejects(db.query("insert into public.medication_fulfillment_events(order_id,actor_id,action,details) values($1,$2,'fake','{}')",[o.id,ids.vet]),{code:'42501'});
  } finally { await db.close(); }
});
test('pharmacy approval, membership, insert validation, decline and cancellation cannot be bypassed', async () => {
  const {db,animal,p1,p2}=await fixture();
  try {
    await db.exec('reset role');
    const signupId='99999999-1234-4234-8234-123456789012';
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[signupId,'newpharmacy@example.com',JSON.stringify({account_type:'pharmacy',role:'admin',approval_status:'approved',pharmacy_id:p1})]);
    const signup=(await db.query('select * from public.profiles where id=$1',[signupId])).rows[0];
    assert.equal(signup.role,'pharmacy');assert.equal(signup.approval_status,'pending');assert.equal(signup.pharmacy_id,null);
    await db.query("update auth.users set raw_user_meta_data='{}' where id=$1",[signupId]);
    assert.equal((await db.query('select role from public.profiles where id=$1',[signupId])).rows[0].role,'pharmacy');
    await login(db,ids.vet);
    await assert.rejects(rpc(db,'save_pharmacy',['Fake pharmacy',null,'approved']),{code:'42501'});
    await assert.rejects(rpc(db,'assign_pharmacy_member',[ids.vet,p1]),{code:'42501'});
    await assert.rejects(create(db,animal,null),{code:'22023'});
    await assert.rejects(create(db,animal,p1,{delivery_address:' '}),{code:'22023'});
    await assert.rejects(create(db,animal,p1,{prescriber_id:ids.otherVet}),{code:'42501'});
    let o=await create(db,animal,p1,{fulfillment_status:'delivered',carrier:'Fake',order_status:'fulfilled',fulfillment_version:900});
    assert.equal(o.fulfillment_status,'awaiting_acceptance'); assert.equal(o.order_status,'pending'); assert.equal(o.carrier,''); assert.equal(o.fulfillment_version,0);
    await login(db,ids.staff);
    await assert.rejects(db.query("update public.profiles set pharmacy_id=$1 where id=$2",[p2,ids.staff]),{code:'42501'});
    o=await update(db,o,'declined',{note:'Cannot supply'});
    await login(db,ids.vet); await rpc(db,'cancel_medication_order',[o.id]);
    await login(db,ids.staff);
    await assert.rejects(update(db,{...o,fulfillment_version:o.fulfillment_version+1},'processing'),{code:'22023'});
    await login(db,ids.admin);
    await assert.rejects(rpc(db,'assign_pharmacy_member',[ids.admin,p1]),{code:'22023'});
    await rpc(db,'save_pharmacy',['Central Pharmacy',p1,'rejected']);
    await login(db,ids.vet); await assert.rejects(create(db,animal,p1),{code:'22023'});
    await login(db,ids.staff);
    assert.equal((await db.query('select public.paws_pharmacy_id()')).rows[0].paws_pharmacy_id,null);
    assert.equal((await db.query('select * from public.medication_orders')).rows.length,0);
    await assert.rejects(update(db,o,'processing'),{code:'42501'});
    await login(db,ids.admin); await rpc(db,'save_pharmacy',['Central Pharmacy',p1,'approved']);
    for (const status of ['pending','rejected']) {
      await db.exec('reset role'); await db.query('update public.profiles set approval_status=$1 where id=$2',[status,ids.staff]); await login(db,ids.staff);
      assert.equal((await db.query('select * from public.medication_orders')).rows.length,0);
      await assert.rejects(update(db,o,'processing'),{code:'42501'});
    }
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from public.medication_orders'),{code:'42501'});
    await assert.rejects(update(db,o,'processing'),{code:'42501'});
  } finally { await db.close(); }
});
