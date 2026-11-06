
-- Allow the original veterinarian to cancel pending orders.

begin;

-- A secure function to cancel an order.
create or replace function public.cancel_medication_order(
  order_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the original prescriber, with an approved
  -- veterinarian account, can cancel a pending order.
  update public.medication_orders
  set
    order_status = 'cancelled',
    updated_at = now()
  where id = order_id
    and prescriber_id = auth.uid()
    and order_status = 'pending'
    and exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'veterinarian'
        and approval_status = 'approved'
    );

  if not found then
    raise exception
      'Order cannot be cancelled. It may already be cancelled or you may not have permission.';
  end if;
end;
$$;

-- Only signed-in users can invoke this function.
revoke all on function public.cancel_medication_order(uuid)
  from public, anon;

grant execute on function public.cancel_medication_order(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
