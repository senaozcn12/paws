import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const userIds=Object.fromEntries(['admin','vet','staff','colleague','otherStaff'].map((name,index)=>[name,`12345678-1234-4234-8234-${String(index+1).padStart(12,'0')}`]));
async function login(db,id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
async function rpc(db,name,args){return(await db.query(`select * from public.${name}(${args.map((_,index)=>`$${index+1}`).join(',')})`,args)).rows[0];}
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create table public.animals(chip_id text primary key,name text,animal text,species text,age integer,sex text,notes text);
 create table public.treatments(id bigint generated always as identity primary key,chip_id text references public.animals(chip_id));
 grant select on public.animals to authenticated;
 create policy existing_read on public.animals for select to authenticated using(true);
 insert into public.animals values('TEST','Mochi','Cat','Shorthair',3,'F','');`);
 for(const name of ['202611050001_registration.sql','202611060001_admin_patient_access.sql','202611060002_create_animals.sql','202611060003_medication_orders.sql','202611060004_cancel_medication_orders.sql','202611060005_pharmacy_fulfillment.sql','202611060006_diagnostic_center_accounts.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
 for(const [name,id]of Object.entries(userIds))await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${name}@example.com`,JSON.stringify({account_type:['staff','colleague','otherStaff'].includes(name)?'diagnostic_staff':'veterinarian',role:'admin',approval_status:'approved'})]);
 await db.query("update public.profiles set role='admin',approval_status='approved' where id=$1",[userIds.admin]);
 await db.query("update public.profiles set approval_status='approved' where id=$1",[userIds.vet]);
 return db;
}
test('diagnostic staff signup stays pending; admins approve centers and isolated shared membership',async()=>{
 const db=await fixture();try{
 await login(db,userIds.staff);
 let profile=(await db.query('select * from public.profiles where id=$1',[userIds.staff])).rows[0];
 assert.equal(profile.role,'diagnostic_staff');assert.equal(profile.approval_status,'pending');assert.equal(profile.diagnostic_center_id,null);
 await assert.rejects(rpc(db,'save_diagnostic_center',['Unauthorized Lab',null,'approved']),{code:'42501'});
 await assert.rejects(rpc(db,'assign_diagnostic_center_member',[userIds.staff,userIds.staff]),{code:'42501'});
 await assert.rejects(db.query("update public.profiles set approval_status='approved' where id=$1",[userIds.staff]),{code:'42501'});
 await login(db,userIds.admin);
 const c1=(await rpc(db,'save_diagnostic_center',[' Central Diagnostics ',null,'approved'])).save_diagnostic_center;
 const c2=(await rpc(db,'save_diagnostic_center',['West Diagnostics',null,'approved'])).save_diagnostic_center;
 await assert.rejects(rpc(db,'save_diagnostic_center',['central diagnostics',null,'approved']),{code:'23505'});
 await assert.rejects(rpc(db,'save_diagnostic_center',[' ',null,'approved']),{code:'22023'});
 await assert.rejects(rpc(db,'review_registration',[userIds.staff,'approved']),{code:'22023'});
 await assert.rejects(rpc(db,'assign_diagnostic_center_member',[userIds.admin,c1]),{code:'22023'});
 await rpc(db,'assign_diagnostic_center_member',[userIds.staff,c1]);
 await rpc(db,'assign_diagnostic_center_member',[userIds.colleague,c1]);
 await rpc(db,'assign_diagnostic_center_member',[userIds.otherStaff,c2]);
 const reviews=(await db.query('select * from public.registration_reviews')).rows;
 assert.equal(reviews.length,3);assert.ok(reviews.every(row=>row.reviewer_id===userIds.admin));
 await login(db,userIds.staff);
 assert.equal((await rpc(db,'paws_diagnostic_center_id',[])).paws_diagnostic_center_id,c1);
 const centers=(await db.query('select * from public.diagnostic_centers')).rows;
 assert.equal(centers.length,1);assert.equal(centers[0].name,'Central Diagnostics');
 assert.equal((await db.query('select * from public.diagnostic_centers where id=$1',[c2])).rows.length,0);
 assert.equal((await db.query('select * from public.animals')).rows.length,0);
 assert.equal((await db.query('select * from public.medication_orders')).rows.length,0);
 assert.equal((await rpc(db,'paws_pharmacy_id',[])).paws_pharmacy_id,null);
 await assert.rejects(db.query("insert into public.diagnostic_centers(name) values('Fake')"),{code:'42501'});
 await assert.rejects(db.query("update public.diagnostic_centers set approval_status='approved' where id=$1",[c1]),{code:'42501'});
 await login(db,userIds.colleague);assert.equal((await rpc(db,'paws_diagnostic_center_id',[])).paws_diagnostic_center_id,c1);
 await login(db,userIds.otherStaff);assert.equal((await rpc(db,'paws_diagnostic_center_id',[])).paws_diagnostic_center_id,c2);
 await login(db,userIds.vet);assert.equal((await db.query('select * from public.diagnostic_centers')).rows.length,2);
 await db.exec('reset role');await db.query("update auth.users set raw_user_meta_data='{}' where id=$1",[userIds.staff]);
 profile=(await db.query('select * from public.profiles where id=$1',[userIds.staff])).rows[0];assert.equal(profile.role,'diagnostic_staff');assert.equal(profile.diagnostic_center_id,c1);assert.equal(profile.approval_status,'approved');
 await db.exec('set role anon');await assert.rejects(db.query('select * from public.diagnostic_centers'),{code:'42501'});await assert.rejects(rpc(db,'save_diagnostic_center',['Fake',null,'approved']),{code:'42501'});
 }finally{await db.close();}
});
test('center suspension, individual rejection and cross-role reassignment revoke effective membership',async()=>{
 const db=await fixture();try{
 await login(db,userIds.admin);
 const center=(await rpc(db,'save_diagnostic_center',['Central Diagnostics',null,'approved'])).save_diagnostic_center;
 const pharmacy=(await rpc(db,'save_pharmacy',['Central Pharmacy',null,'approved'])).save_pharmacy;
 await rpc(db,'assign_diagnostic_center_member',[userIds.staff,center]);
 await rpc(db,'save_diagnostic_center',['Central Diagnostics',center,'rejected']);
 await login(db,userIds.staff);assert.equal((await rpc(db,'paws_diagnostic_center_id',[])).paws_diagnostic_center_id,null);assert.equal((await db.query('select * from public.diagnostic_centers')).rows.length,0);
 await login(db,userIds.admin);await assert.rejects(rpc(db,'assign_diagnostic_center_member',[userIds.colleague,center]),{code:'22023'});await assert.rejects(rpc(db,'review_registration',[userIds.staff,'approved']),{code:'22023'});
 await rpc(db,'save_diagnostic_center',['Central Diagnostics',center,'approved']);
 for(const decision of ['rejected','pending']){
  await db.exec('reset role');await db.query('update public.profiles set approval_status=$1 where id=$2',[decision,userIds.staff]);await login(db,userIds.staff);assert.equal((await rpc(db,'paws_diagnostic_center_id',[])).paws_diagnostic_center_id,null);
 }
 await login(db,userIds.admin);await rpc(db,'review_registration',[userIds.staff,'approved']);
 await rpc(db,'review_registration',[userIds.staff,'rejected']);
 assert.equal((await db.query('select approval_status from public.profiles where id=$1',[userIds.staff])).rows[0].approval_status,'rejected');
 await rpc(db,'assign_diagnostic_center_member',[userIds.staff,center]);
 await rpc(db,'assign_pharmacy_member',[userIds.staff,pharmacy]);
 let p=(await db.query('select * from public.profiles where id=$1',[userIds.staff])).rows[0];assert.equal(p.role,'pharmacy');assert.equal(p.diagnostic_center_id,null);
 await login(db,userIds.staff);assert.equal((await rpc(db,'paws_diagnostic_center_id',[])).paws_diagnostic_center_id,null);assert.equal((await rpc(db,'paws_pharmacy_id',[])).paws_pharmacy_id,pharmacy);
 await login(db,userIds.admin);await rpc(db,'assign_diagnostic_center_member',[userIds.staff,center]);
 p=(await db.query('select * from public.profiles where id=$1',[userIds.staff])).rows[0];assert.equal(p.pharmacy_id,null);assert.equal(p.diagnostic_center_id,center);
 await login(db,userIds.staff);assert.equal((await rpc(db,'paws_pharmacy_id',[])).paws_pharmacy_id,null);assert.equal((await rpc(db,'paws_diagnostic_center_id',[])).paws_diagnostic_center_id,center);
 await db.exec('reset role');await db.query("update public.profiles set approval_status='rejected' where id=$1",[userIds.admin]);await login(db,userIds.admin);await assert.rejects(rpc(db,'save_diagnostic_center',['Denied',null,'approved']),{code:'42501'});
 }finally{await db.close();}
});
