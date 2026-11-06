-- Apply after 202611050001_registration.sql. Existing approval gates use this function.
begin;
create or replace function public.paws_can_access_records()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('veterinarian', 'admin')
      and approval_status = 'approved'
  );
$$;
revoke all on function public.paws_can_access_records() from public, anon;
grant execute on function public.paws_can_access_records() to authenticated;
commit;
