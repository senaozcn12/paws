-- Apply after migrations 001 through 004. Existing orders remain unassigned until routed by their prescriber.
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('veterinarian','admin','pharmacy'));
-- Public signup can request only a pending veterinarian or pharmacy account; never admin/approved.
create or replace function public.create_paws_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,full_name,country,region,role,approval_status)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.raw_user_meta_data->>'country',''),coalesce(new.raw_user_meta_data->>'region',''),
    case when new.raw_user_meta_data->>'account_type'='pharmacy' then 'pharmacy' else 'veterinarian' end,'pending');
  return new;
end $$;
create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 150),
  approval_status text not null default 'approved' check(approval_status in ('approved','rejected')),
  created_at timestamptz not null default now()
);
create unique index pharmacies_name_unique on public.pharmacies(lower(btrim(name)));
alter table public.profiles add column pharmacy_id uuid references public.pharmacies(id);
alter table public.pharmacies enable row level security;
revoke all on public.pharmacies from anon, authenticated;
grant select on public.pharmacies to authenticated;

create function public.paws_pharmacy_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.pharmacy_id from public.profiles p join public.pharmacies f on f.id=p.pharmacy_id
  where p.id=auth.uid() and p.role='pharmacy' and p.approval_status='approved' and f.approval_status='approved';
$$;
revoke all on function public.paws_pharmacy_id() from public, anon;
grant execute on function public.paws_pharmacy_id() to authenticated;
create policy pharmacies_read on public.pharmacies for select to authenticated
using (public.paws_is_admin() or (approval_status='approved' and public.paws_can_access_records()) or id=public.paws_pharmacy_id());

create function public.save_pharmacy(pharmacy_name text, target_id uuid default null, decision text default 'approved')
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not public.paws_is_admin() then raise exception using errcode='42501', message='Administrator required'; end if;
  if pharmacy_name is null or length(btrim(pharmacy_name)) not between 1 and 150 or decision is null or decision not in ('approved','rejected') then
    raise exception using errcode='22023', message='Valid pharmacy name and approval required';
  end if;
  if target_id is null then
    insert into public.pharmacies(name,approval_status) values(btrim(pharmacy_name),decision) returning id into result;
  else
    update public.pharmacies set name=btrim(pharmacy_name),approval_status=decision where id=target_id returning id into result;
    if not found then raise exception using errcode='22023', message='Pharmacy not found'; end if;
  end if;
  return result;
end $$;
create function public.assign_pharmacy_member(member_id uuid, target_pharmacy uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.paws_is_admin() then raise exception using errcode='42501', message='Administrator required'; end if;
  perform 1 from public.pharmacies where id=target_pharmacy and approval_status='approved' for share;
  if not found then raise exception using errcode='22023', message='Select an approved pharmacy'; end if;
  update public.profiles set role='pharmacy',pharmacy_id=target_pharmacy,approval_status='approved'
  where id=member_id and role<>'admin';
  if not found then raise exception using errcode='22023', message='Select an existing non-admin account'; end if;
  insert into public.registration_reviews(applicant_id,reviewer_id,decision) values(member_id,auth.uid(),'approved');
end $$;
create or replace function public.review_registration(applicant_id uuid, decision text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.paws_is_admin() then raise exception using errcode='42501', message='Administrator required'; end if;
  if decision is null or decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  update public.profiles p set approval_status=decision
  where p.id=applicant_id and p.role in ('veterinarian','pharmacy')
    and (decision='rejected' or p.role='veterinarian' or exists(select 1 from public.pharmacies where id=p.pharmacy_id and approval_status='approved'));
  if not found then raise exception 'Applicant not found or pharmacy is not approved'; end if;
  insert into public.registration_reviews(applicant_id,reviewer_id,decision) values(applicant_id,auth.uid(),decision);
end $$;

alter table public.medication_orders
  add column assigned_pharmacy_id uuid references public.pharmacies(id),
  add column pharmacy_name text,
  add column delivery_address text not null default '',
  add column fulfillment_status text not null default 'unassigned'
    check(fulfillment_status in ('unassigned','awaiting_acceptance','processing','declined','shipped','delivered','cancelled')),
  add column fulfillment_note text not null default '' check(length(fulfillment_note)<=1000),
  add column carrier text not null default '' check(length(carrier)<=100),
  add column tracking_number text not null default '' check(length(tracking_number)<=200),
  add column tracking_url text not null default '' check(length(tracking_url)<=1000 and (tracking_url='' or tracking_url ~ '^https://[^[:space:]]+$')),
  add column fulfillment_version integer not null default 0;
alter table public.medication_orders drop constraint medication_orders_order_status_check;
alter table public.medication_orders add constraint medication_orders_order_status_check check(order_status in ('pending','cancelled','fulfilled'));
update public.medication_orders set fulfillment_status='cancelled' where order_status='cancelled';
create index medication_orders_pharmacy_idx on public.medication_orders(assigned_pharmacy_id,created_at desc);
revoke update, delete on public.medication_orders from anon, authenticated;
create policy pharmacy_assigned_orders_read on public.medication_orders for select to authenticated
using (assigned_pharmacy_id=(select public.paws_pharmacy_id()));

create table public.medication_fulfillment_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.medication_orders(id),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.medication_fulfillment_events enable row level security;
revoke all on public.medication_fulfillment_events from anon, authenticated;
grant select on public.medication_fulfillment_events to authenticated;
create policy fulfillment_events_read on public.medication_fulfillment_events for select to authenticated
using (exists(select 1 from public.medication_orders o where o.id=order_id));

create function public.initialize_medication_fulfillment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='veterinarian' and approval_status='approved')
    or new.prescriber_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='Approved original veterinarian required';
  end if;
  select name into new.pharmacy_name from public.pharmacies
  where id=new.assigned_pharmacy_id and approval_status='approved' for share;
  if not found then raise exception using errcode='22023',message='Select an approved pharmacy'; end if;
  new.delivery_address:=btrim(new.delivery_address);
  if new.delivery_address is null or length(new.delivery_address) not between 5 and 2000 then
    raise exception using errcode='22023',message='Enter clinic delivery details (5 to 2000 characters)';
  end if;
  new.order_status:='pending'; new.fulfillment_status:='awaiting_acceptance'; new.fulfillment_version:=0;
  new.fulfillment_note:=''; new.carrier:=''; new.tracking_number:=''; new.tracking_url:='';
  new.created_at:=now(); new.updated_at:=now();
  return new;
end $$;
create trigger initialize_medication_fulfillment before insert on public.medication_orders
for each row execute function public.initialize_medication_fulfillment();
create function public.log_medication_fulfillment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.medication_fulfillment_events(order_id,actor_id,action,details)
  values(new.id,auth.uid(),case when tg_op='INSERT' then 'assigned' else new.fulfillment_status end,
    jsonb_build_object('pharmacy_id',new.assigned_pharmacy_id,'status',new.fulfillment_status,'note',new.fulfillment_note,
      'carrier',new.carrier,'tracking_number',new.tracking_number,'tracking_url',new.tracking_url,
      'delivery_address',new.delivery_address,'version',new.fulfillment_version));
  return new;
end $$;
create trigger log_medication_fulfillment after insert or update on public.medication_orders
for each row execute function public.log_medication_fulfillment();
revoke all on function public.initialize_medication_fulfillment(),public.log_medication_fulfillment() from public,anon,authenticated;

create function public.assign_medication_pharmacy(order_id uuid, target_pharmacy uuid, clinic_address text, expected_version integer)
returns public.medication_orders language plpgsql security definer set search_path = '' as $$
declare o public.medication_orders; selected_name text;
begin
  select * into o from public.medication_orders where id=order_id for update;
  if not found or o.prescriber_id is distinct from auth.uid() or not exists(
    select 1 from public.profiles where id=auth.uid() and role='veterinarian' and approval_status='approved'
  ) then raise exception using errcode='42501',message='Original approved prescriber required'; end if;
  if expected_version is distinct from o.fulfillment_version then raise exception using errcode='40001',message='Order changed. Refresh and try again'; end if;
  if o.order_status<>'pending' or o.fulfillment_status not in ('unassigned','awaiting_acceptance','declined') then
    raise exception using errcode='22023',message='Pharmacy must release an accepted order before reassignment';
  end if;
  select name into selected_name from public.pharmacies where id=target_pharmacy and approval_status='approved' for share;
  if not found or clinic_address is null or length(btrim(clinic_address)) not between 5 and 2000 then
    raise exception using errcode='22023',message='Approved pharmacy and clinic delivery details required';
  end if;
  update public.medication_orders set assigned_pharmacy_id=target_pharmacy,pharmacy_name=selected_name,
    delivery_address=btrim(clinic_address),fulfillment_status='awaiting_acceptance',fulfillment_note='',
    carrier='',tracking_number='',tracking_url='',fulfillment_version=fulfillment_version+1,updated_at=now()
  where id=order_id returning * into o;
  return o;
end $$;

create function public.update_medication_fulfillment(order_id uuid, next_status text, expected_version integer,
  shipping_carrier text default '', shipping_number text default '', shipping_url text default '', note text default '')
returns public.medication_orders language plpgsql security definer set search_path = '' as $$
declare o public.medication_orders; pharmacy uuid;
begin
  pharmacy:=public.paws_pharmacy_id();
  if pharmacy is null then raise exception using errcode='42501',message='Approved pharmacy membership required'; end if;
  select * into o from public.medication_orders where id=order_id and assigned_pharmacy_id=pharmacy for update;
  if not found then raise exception using errcode='42501',message='Assigned pharmacy required'; end if;
  if expected_version is distinct from o.fulfillment_version then raise exception using errcode='40001',message='Order changed. Refresh and try again'; end if;
  if o.order_status<>'pending' or next_status is null or not (
    (o.fulfillment_status='awaiting_acceptance' and next_status in ('processing','declined')) or
    (o.fulfillment_status='processing' and next_status in ('shipped','declined')) or
    (o.fulfillment_status='shipped' and next_status in ('shipped','delivered'))
  ) then raise exception using errcode='22023',message='Invalid fulfillment transition'; end if;
  shipping_carrier:=btrim(coalesce(shipping_carrier,'')); shipping_number:=btrim(coalesce(shipping_number,''));
  shipping_url:=btrim(coalesce(shipping_url,'')); note:=btrim(coalesce(note,''));
  if length(shipping_carrier)>100 or length(shipping_number)>200 or length(shipping_url)>1000 or length(note)>1000
    or (shipping_url<>'' and shipping_url !~ '^https://[^[:space:]]+$') then
    raise exception using errcode='22023',message='Invalid tracking information';
  end if;
  if next_status='declined' and note='' then raise exception using errcode='22023',message='Enter a decline or release reason'; end if;
  if next_status in ('shipped','delivered') and (shipping_carrier='' or shipping_number='') then
    raise exception using errcode='22023',message='Carrier and tracking number required';
  end if;
  update public.medication_orders set fulfillment_status=next_status,fulfillment_note=note,
    carrier=case when next_status in ('shipped','delivered') then shipping_carrier else '' end,
    tracking_number=case when next_status in ('shipped','delivered') then shipping_number else '' end,
    tracking_url=case when next_status in ('shipped','delivered') then shipping_url else '' end,
    order_status=case when next_status='delivered' then 'fulfilled' else 'pending' end,
    fulfillment_version=fulfillment_version+1,updated_at=now() where id=order_id returning * into o;
  return o;
end $$;

create or replace function public.cancel_medication_order(order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.medication_orders set order_status='cancelled',fulfillment_status='cancelled',
    fulfillment_version=fulfillment_version+1,updated_at=now()
  where id=order_id and prescriber_id=auth.uid() and order_status='pending'
    and fulfillment_status in ('unassigned','awaiting_acceptance','declined')
    and exists(select 1 from public.profiles where id=auth.uid() and role='veterinarian' and approval_status='approved');
  if not found then raise exception using errcode='22023',message='Cannot cancel: pharmacy must release an accepted order first'; end if;
end $$;
revoke all on function public.save_pharmacy(text,uuid,text), public.assign_pharmacy_member(uuid,uuid),
  public.assign_medication_pharmacy(uuid,uuid,text,integer),public.update_medication_fulfillment(uuid,text,integer,text,text,text,text)
  from public,anon;
grant execute on function public.save_pharmacy(text,uuid,text), public.assign_pharmacy_member(uuid,uuid),
  public.assign_medication_pharmacy(uuid,uuid,text,integer),public.update_medication_fulfillment(uuid,text,integer,text,text,text,text)
  to authenticated;
notify pgrst, 'reload schema';
commit;
