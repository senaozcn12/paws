-- Review in staging and back up existing policies before applying. No remote changes are automatic.
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  country text not null default '',
  region text not null default '',
  role text not null default 'veterinarian' check (role in ('veterinarian', 'admin')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create function public.create_paws_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,full_name,country,region)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.raw_user_meta_data->>'country',''),coalesce(new.raw_user_meta_data->>'region',''));
  return new;
end; $$;
create trigger paws_profile_after_signup after insert on auth.users for each row execute function public.create_paws_profile();
-- Existing accounts remain pending until explicitly reviewed by a trusted operator.
insert into public.profiles(id,email) select id,coalesce(email,'') from auth.users on conflict do nothing;
create function public.paws_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role='admin' and approval_status='approved');
$$;
create function public.paws_can_access_records() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role='veterinarian' and approval_status='approved');
$$;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() or public.paws_is_admin());
create table public.registration_reviews (
  id bigint generated always as identity primary key,
  applicant_id uuid not null references public.profiles(id),
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approved','rejected')),
  reviewed_at timestamptz not null default now()
);
alter table public.registration_reviews enable row level security;
revoke all on public.registration_reviews from anon, authenticated;
grant select on public.registration_reviews to authenticated;
create policy review_read on public.registration_reviews for select to authenticated using(public.paws_is_admin());
create function public.review_registration(applicant_id uuid, decision text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.paws_is_admin() then raise exception 'Administrator access required'; end if;
  if decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  update public.profiles set approval_status=decision where id=applicant_id and role='veterinarian';
  if not found then raise exception 'Applicant not found'; end if;
  insert into public.registration_reviews(applicant_id,reviewer_id,decision) values(applicant_id,auth.uid(),decision);
end; $$;
revoke all on function public.review_registration(uuid,text) from public, anon;
grant execute on function public.review_registration(uuid,text) to authenticated;
revoke all on function public.create_paws_profile() from public, anon, authenticated;
revoke all on function public.paws_is_admin(), public.paws_can_access_records() from public, anon;
grant execute on function public.paws_is_admin(), public.paws_can_access_records() to authenticated;
-- Restrictive policies compose with all preexisting permissive policies, preventing bypass.
-- A permissive policy is still required for each intended operation.
alter table public.animals enable row level security;
alter table public.treatments enable row level security;
create policy paws_approval_gate on public.animals as restrictive for all to public using ((select public.paws_can_access_records())) with check ((select public.paws_can_access_records()));
create policy paws_approval_gate on public.treatments as restrictive for all to public using ((select public.paws_can_access_records())) with check ((select public.paws_can_access_records()));
commit;
