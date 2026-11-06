-- PAWS diagnostic-center queue
-- Proposed migration. Test in a staging database and coordinate application order.
-- Requires public.animals.global_id, public.diagnostic_centers and public.profiles.
begin;

create table public.diagnostic_requests (
  id uuid primary key default gen_random_uuid(),
  animal_global_id uuid not null references public.animals(global_id),
  assigned_center_id uuid not null references public.diagnostic_centers(id),
  requested_by uuid not null default auth.uid() references auth.users(id),
  test_name text not null check (length(btrim(test_name)) between 1 and 150),
  instructions text not null default '' check (length(instructions) <= 2000),
  status text not null default 'requested'
    check (status in ('requested', 'in_progress', 'completed', 'unable_to_complete')),
  unable_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint diagnostic_unable_reason_check check (
    (status = 'unable_to_complete' and unable_reason is not null
      and length(btrim(unable_reason)) between 5 and 1000)
    or (status <> 'unable_to_complete' and unable_reason is null)
  )
);
create index diagnostic_requests_center_status_idx
  on public.diagnostic_requests(assigned_center_id, status, created_at desc);

alter table public.diagnostic_requests enable row level security;
revoke all on public.diagnostic_requests from public, anon, authenticated;
grant select, insert on public.diagnostic_requests to authenticated;

-- Approved staff only see requests assigned to their approved center.
-- Approved requesting vets can see their own requests; admins can review.
create policy diagnostic_requests_read on public.diagnostic_requests
for select to authenticated using (
  assigned_center_id = (select public.paws_diagnostic_center_id())
  or (requested_by = (select auth.uid()) and (select public.paws_can_access_records()))
  or (select public.paws_is_admin())
);

-- Only approved veterinarians can submit requests to approved centers.
create policy diagnostic_requests_insert on public.diagnostic_requests
for insert to authenticated with check (
  requested_by = (select auth.uid())
  and status = 'requested' and unable_reason is null and updated_by is null
  and exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role = 'veterinarian' and p.approval_status = 'approved'
  )
  and exists (
    select 1 from public.diagnostic_centers c
      where c.id = assigned_center_id and c.approval_status = 'approved'
  )
);

-- Only this RPC can update status; no UPDATE grant/policy is exposed to clients.
create function public.update_diagnostic_request(
  request_id uuid, next_status text, reason text default null
) returns public.diagnostic_requests
language plpgsql security definer set search_path = '' as $$
declare
  center_id uuid;
  current_record public.diagnostic_requests;
  result public.diagnostic_requests;
begin
  center_id := public.paws_diagnostic_center_id();
  if center_id is null then
    raise exception using errcode='42501', message='Approved diagnostic center membership required';
  end if;
  if next_status is null or next_status not in ('in_progress','completed','unable_to_complete') then
    raise exception using errcode='22023', message='Invalid diagnostic request status';
  end if;
  if next_status = 'unable_to_complete' and
     (reason is null or length(btrim(reason)) not between 5 and 1000) then
    raise exception using errcode='22023', message='A reason of 5 to 1000 characters is required';
  end if;
  select * into current_record from public.diagnostic_requests d
    where d.id = request_id and d.assigned_center_id = center_id for update;
  if not found then
    raise exception using errcode='42501', message='Request not found for your center';
  end if;
  if not (
    (current_record.status = 'requested' and next_status in ('in_progress','unable_to_complete'))
    or (current_record.status = 'in_progress' and next_status in ('completed','unable_to_complete'))
  ) then
    raise exception using errcode='22023', message='This status transition is not allowed';
  end if;
  update public.diagnostic_requests d set
    status = next_status,
    unable_reason = case when next_status='unable_to_complete' then btrim(reason) else null end,
    updated_at = now(), updated_by = auth.uid()
  where d.id = request_id returning * into result;
  return result;
end $$;
revoke all on function public.update_diagnostic_request(uuid,text,text) from public, anon;
grant execute on function public.update_diagnostic_request(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
