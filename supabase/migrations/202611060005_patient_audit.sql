
-- Patient demographic editing and change history.
-- Review and test in staging before applying to shared Supabase.

begin;

-- Permit approved users to edit demographic columns.
grant update (name, animal, species, age, sex)
on public.animals to authenticated;

create policy paws_edit_animal
on public.animals
for update
to authenticated
using ((select public.paws_can_access_records()))
with check ((select public.paws_can_access_records()));

-- Store changes made to animal records.
create table public.animal_change_history (
  id bigint generated always as identity primary key,
  animal_global_id uuid not null
    references public.animals(global_id),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  changes jsonb not null
);

alter table public.animal_change_history
enable row level security;

-- Approved users may view change history.
create policy animal_history_read
on public.animal_change_history
for select
to authenticated
using ((select public.paws_can_access_records()));

grant select on public.animal_change_history
to authenticated;

-- Do not grant application users permission
-- to insert, edit or delete audit entries.

create function public.log_animal_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
  before_values jsonb;
  after_values jsonb;
  changed_values jsonb := '{}'::jsonb;
begin
  before_values := jsonb_build_object(
    'name', old.name,
    'animal', old.animal,
    'species', old.species,
    'age', old.age,
    'sex', old.sex
  );

  after_values := jsonb_build_object(
    'name', new.name,
    'animal', new.animal,
    'species', new.species,
    'age', new.age,
    'sex', new.sex
  );

  foreach field_name in array
    array['name', 'animal', 'species', 'age', 'sex']
  loop
    if before_values->field_name
       is distinct from after_values->field_name then

      changed_values := changed_values || jsonb_build_object(
        field_name,
        jsonb_build_object(
          'before', before_values->field_name,
          'after', after_values->field_name
        )
      );
    end if;
  end loop;

  if changed_values <> '{}'::jsonb then
    if auth.uid() is null then
      raise exception 'Authenticated editor required';
    end if;

    insert into public.animal_change_history (
      animal_global_id,
      changed_by,
      changes
    )
    values (
      new.global_id,
      auth.uid(),
      changed_values
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_animal_changes()
from public, anon, authenticated;

create trigger paws_animal_change_audit
after update on public.animals
for each row
execute function public.log_animal_changes();

notify pgrst, 'reload schema';

commit;
