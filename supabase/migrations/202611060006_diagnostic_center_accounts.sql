-- Apply after 202611060005_pharmacy_fulfillment.sql. This migration adds accounts/approval only.
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check(role in ('veterinarian','admin','pharmacy','diagnostic_staff'));
create table public.diagnostic_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 150),
  approval_status text not null default 'approved' check(approval_status in ('approved','rejected')),
  created_at timestamptz not null default now()
);
create unique index diagnostic_centers_name_unique on public.diagnostic_centers(lower(btrim(name)));
alter table public.profiles add column diagnostic_center_id uuid references public.diagnostic_centers(id);
alter table public.diagnostic_centers enable row level security;
revoke all on public.diagnostic_centers from anon,authenticated;
grant select on public.diagnostic_centers to authenticated;

create function public.paws_diagnostic_center_id() returns uuid
language sql stable security definer set search_path='' as $$
  select p.diagnostic_center_id from public.profiles p
  join public.diagnostic_centers c on c.id=p.diagnostic_center_id
  where p.id=auth.uid() and p.role='diagnostic_staff' and p.approval_status='approved' and c.approval_status='approved';
$$;
revoke all on function public.paws_diagnostic_center_id() from public,anon;
grant execute on function public.paws_diagnostic_center_id() to authenticated;
create policy diagnostic_centers_read on public.diagnostic_centers for select to authenticated
using (public.paws_is_admin() or (approval_status='approved' and public.paws_can_access_records()) or id=public.paws_diagnostic_center_id());

create function public.save_diagnostic_center(center_name text, target_id uuid default null, decision text default 'approved')
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not public.paws_is_admin() then raise exception using errcode='42501',message='Administrator required'; end if;
  if center_name is null or length(btrim(center_name)) not between 1 and 150 or decision is null or decision not in ('approved','rejected') then
    raise exception using errcode='22023',message='Valid center name and approval required';
  end if;
  if target_id is null then
    insert into public.diagnostic_centers(name,approval_status) values(btrim(center_name),decision) returning id into result;
  else
    update public.diagnostic_centers set name=btrim(center_name),approval_status=decision where id=target_id returning id into result;
    if not found then raise exception using errcode='22023',message='Diagnostic center not found'; end if;
  end if;
  return result;
end $$;
create function public.assign_diagnostic_center_member(member_id uuid, target_center uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.paws_is_admin() then raise exception using errcode='42501',message='Administrator required'; end if;
  perform 1 from public.diagnostic_centers where id=target_center and approval_status='approved' for share;
  if not found then raise exception using errcode='22023',message='Select an approved diagnostic center'; end if;
  update public.profiles set role='diagnostic_staff',diagnostic_center_id=target_center,pharmacy_id=null,approval_status='approved'
  where id=member_id and role<>'admin';
  if not found then raise exception using errcode='22023',message='Select an existing non-admin account'; end if;
  insert into public.registration_reviews(applicant_id,reviewer_id,decision) values(member_id,auth.uid(),'approved');
end $$;
-- Switching an account back to a pharmacy must not leave an old center membership behind.
create or replace function public.assign_pharmacy_member(member_id uuid, target_pharmacy uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.paws_is_admin() then raise exception using errcode='42501',message='Administrator required'; end if;
  perform 1 from public.pharmacies where id=target_pharmacy and approval_status='approved' for share;
  if not found then raise exception using errcode='22023',message='Select an approved pharmacy'; end if;
  update public.profiles set role='pharmacy',pharmacy_id=target_pharmacy,diagnostic_center_id=null,approval_status='approved'
  where id=member_id and role<>'admin';
  if not found then raise exception using errcode='22023',message='Select an existing non-admin account'; end if;
  insert into public.registration_reviews(applicant_id,reviewer_id,decision) values(member_id,auth.uid(),'approved');
end $$;
create or replace function public.create_paws_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,email,full_name,country,region,role,approval_status)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.raw_user_meta_data->>'country',''),coalesce(new.raw_user_meta_data->>'region',''),
    case when new.raw_user_meta_data->>'account_type' in ('pharmacy','diagnostic_staff')
      then new.raw_user_meta_data->>'account_type' else 'veterinarian' end,'pending');
  return new;
end $$;
create or replace function public.review_registration(applicant_id uuid, decision text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.paws_is_admin() then raise exception using errcode='42501',message='Administrator required'; end if;
  if decision is null or decision not in ('approved','rejected') then raise exception using errcode='22023',message='Invalid decision'; end if;
  update public.profiles p set approval_status=decision
  where p.id=applicant_id and p.role in ('veterinarian','pharmacy','diagnostic_staff') and (
    decision='rejected' or p.role='veterinarian' or
    (p.role='pharmacy' and exists(select 1 from public.pharmacies where id=p.pharmacy_id and approval_status='approved')) or
    (p.role='diagnostic_staff' and exists(select 1 from public.diagnostic_centers where id=p.diagnostic_center_id and approval_status='approved'))
  );
  if not found then raise exception using errcode='22023',message='Applicant not found or approved organization assignment required'; end if;
  insert into public.registration_reviews(applicant_id,reviewer_id,decision) values(applicant_id,auth.uid(),decision);
end $$;
revoke all on function public.save_diagnostic_center(text,uuid,text),public.assign_diagnostic_center_member(uuid,uuid) from public,anon;
grant execute on function public.save_diagnostic_center(text,uuid,text),public.assign_diagnostic_center_member(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
