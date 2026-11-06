-- Requires both registration/admin migrations. Review existing schema in staging first.
begin;
lock table public.animals in share row exclusive mode;
-- Stop before modifying data if imported Chip IDs conflict. Never silently merge patients.
do $$ begin
  if exists (select 1 from public.animals where chip_id is not null
    group by lower(btrim(chip_id)) having count(*) > 1) then
    raise exception 'Duplicate Chip IDs exist (ignoring case/spaces). Resolve them and related records before applying this migration.';
  end if;
end $$;
alter table public.animals add column global_id uuid not null default gen_random_uuid();
alter table public.animals add constraint animals_global_id_unique unique (global_id);
create unique index animals_chip_id_normalized_unique on public.animals (lower(btrim(chip_id)));

create function public.validate_animal_identifiers() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Always assign on the server, regardless of a caller-provided value.
    new.global_id := gen_random_uuid();
    new.chip_id := btrim(new.chip_id);
    new.name := btrim(new.name);
    new.animal := btrim(new.animal);
    new.species := btrim(new.species);
  elsif new.global_id is distinct from old.global_id then
    raise exception using errcode = '23514', message = 'Global ID cannot be changed';
  end if;
  if new.chip_id is null or btrim(new.chip_id) = '' or length(new.chip_id) > 128
    or new.name is null or btrim(new.name) = '' or length(new.name) > 100
    or new.animal is null or btrim(new.animal) = '' or length(new.animal) > 100
    or new.species is null or btrim(new.species) = '' or length(new.species) > 100 then
    raise exception using errcode = '23514', message = 'Chip ID, name, animal type and breed/species are required and must fit their maximum lengths';
  end if;
  if new.age is not null and (new.age::text !~ '^[0-9]+$') then
    raise exception using errcode = '23514', message = 'Age must be a nonnegative whole number';
  end if;
  if new.sex is not null and new.sex not in ('F','M','U') then
    raise exception using errcode = '23514', message = 'Sex must be F, M, U or null';
  end if;
  if length(coalesce(new.notes, '')) > 5000 then
    raise exception using errcode = '23514', message = 'Notes cannot exceed 5000 characters';
  end if;
  return new;
end $$;
create trigger paws_validate_animal before insert or update on public.animals
for each row execute function public.validate_animal_identifiers();
revoke all on function public.validate_animal_identifiers() from public, anon, authenticated;

-- SECURITY INVOKER preserves table RLS, including existing restrictive approval gates.
create function public.create_animal(details jsonb) returns public.animals
language plpgsql security invoker set search_path = '' as $$
declare result public.animals;
begin
  if not public.paws_can_access_records() then
    raise exception using errcode = '42501', message = 'Approved account required';
  end if;
  if details is null or jsonb_typeof(details) <> 'object' then
    raise exception using errcode = '22023', message = 'Animal details must be an object';
  end if;
  -- Populate the existing age column's actual type (CSV imports may use text or numeric).
  insert into public.animals (chip_id, name, animal, species, age, sex, notes)
  select chip_id, name, animal, species, age, sex, notes
  from jsonb_populate_record(null::public.animals, jsonb_build_object(
    'chip_id', btrim(details->>'chip_id'), 'name', btrim(details->>'name'),
    'animal', btrim(details->>'animal'), 'species', btrim(details->>'species'),
    'age', nullif(btrim(details->>'age'), ''), 'sex', nullif(details->>'sex', ''),
    'notes', coalesce(details->>'notes', '')
  )) returning * into result;
  return result;
end $$;
revoke all on function public.create_animal(jsonb) from public, anon;
grant execute on function public.create_animal(jsonb) to authenticated;
grant insert on public.animals to authenticated;
create policy paws_create_animal on public.animals for insert to authenticated
with check ((select public.paws_can_access_records()));
-- Existing SELECT policies/grants still apply to RETURNING and searches.
notify pgrst, 'reload schema';
commit;
