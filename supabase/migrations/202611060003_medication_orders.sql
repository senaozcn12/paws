begin;

create table public.medication_orders (
  id uuid primary key default gen_random_uuid(),

  animal_global_id uuid not null
    references public.animals(global_id),

  medication_name text not null
    check (
      length(btrim(medication_name)) between 1 and 150
    ),

  dosage text not null
    check (
      length(btrim(dosage)) between 1 and 100
    ),

  frequency text not null
    check (
      length(btrim(frequency)) between 1 and 100
    ),

  reason text not null
    check (
      length(btrim(reason)) between 1 and 1000
    ),

  prescriber_id uuid not null
    default auth.uid()
    references public.profiles(id),

  order_status text not null
    default 'pending'
    check (order_status in ('pending', 'cancelled')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Improve lookup performance for an animal's orders.
create index medication_orders_animal_idx
  on public.medication_orders(animal_global_id);

-- Enable database-level access restrictions.
alter table public.medication_orders
  enable row level security;

-- Only authenticated users receive table permissions.
revoke all on public.medication_orders
  from anon, authenticated;

grant select, insert on public.medication_orders
  to authenticated;

-- Approved veterinarians and admins can view orders.
create policy medication_orders_read
on public.medication_orders
for select
to authenticated
using (
  (select public.paws_can_access_records())
);

-- Only approved veterinarians can create orders.
-- The prescriber must match the authenticated user.
create policy medication_orders_insert
on public.medication_orders
for insert
to authenticated
with check (
  prescriber_id = (select auth.uid())
  and order_status = 'pending'
  and exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'veterinarian'
      and approval_status = 'approved'
  )
);

notify pgrst, 'reload schema';

commit;
