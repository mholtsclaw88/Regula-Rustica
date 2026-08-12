-- Records v2 uses existing relationship and recurring Task infrastructure.
-- This migration adds semantic validation without changing the RLS boundary.

create unique index record_relationships_one_current_location_idx
  on public.record_relationships (source_record_id)
  where relationship_type = 'located_on' and deleted_at is null and ended_at is null;

create unique index record_relationships_one_parent_role_idx
  on public.record_relationships (target_record_id, (details ->> 'parentRole'))
  where relationship_type = 'parent_of' and deleted_at is null and ended_at is null;

create or replace function private.validate_record_relationship_v2()
returns trigger language plpgsql set search_path = '' as $$
declare
  source_record public.records%rowtype;
  target_record public.records%rowtype;
  parent_role text;
begin
  select * into source_record from public.records where id = new.source_record_id;
  select * into target_record from public.records where id = new.target_record_id;
  if not found or source_record.id is null or target_record.id is null
     or source_record.homestead_id is distinct from new.homestead_id
     or target_record.homestead_id is distinct from new.homestead_id then
    raise exception 'Relationship records must belong to this Homestead' using errcode = '23503';
  end if;
  if source_record.deleted_at is not null or target_record.deleted_at is not null then
    raise exception 'Active relationships require active Records' using errcode = '23514';
  end if;
  if new.relationship_type = 'located_on' then
    if source_record.type not in ('animal', 'equipment') or target_record.type not in ('land', 'structure') then
      raise exception 'Current location supports Animal or Equipment to Land or Structure' using errcode = '23514';
    end if;
    new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('purpose', 'current_location');
  elsif new.relationship_type = 'parent_of' then
    parent_role := new.details ->> 'parentRole';
    if source_record.type <> 'animal' or target_record.type <> 'animal'
       or lower(coalesce(target_record.identity ->> 'managedAs', target_record.identity ->> 'managed_as', 'individual')) = 'group'
       or coalesce(parent_role, '') not in ('dam', 'sire') then
      raise exception 'Parentage requires individual Animals and a Dam or Sire role' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger validate_record_relationship_v2
  before insert or update on public.record_relationships
  for each row execute function private.validate_record_relationship_v2();

create or replace function private.validate_record_responsibility_v2()
returns trigger language plpgsql set search_path = '' as $$
declare
  responsible_text text := new.stewardship ->> 'responsiblePersonId';
  responsible_id uuid;
begin
  if coalesce(responsible_text, '') = '' then return new; end if;
  begin
    responsible_id := responsible_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Responsible Person must use a stable Person identifier' using errcode = '23514';
  end;
  if not exists (
    select 1 from public.homestead_people p
    where p.id = responsible_id and p.homestead_id = new.homestead_id and p.deleted_at is null
  ) then
    raise exception 'Responsible Person must be active in this Homestead' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger validate_record_responsibility_v2
  before insert or update on public.records
  for each row execute function private.validate_record_responsibility_v2();

drop index public.tasks_one_active_routine_per_animal;
create unique index tasks_one_active_routine_per_animal
  on public.tasks (homestead_id, record_id, (recurrence_rule ->> 'routineType'))
  where deleted_at is null and status in ('open', 'in_progress')
    and recurrence_rule ->> 'routineType' is not null;

create or replace function private.validate_routine_task_configuration()
returns trigger language plpgsql set search_path = '' as $$
declare
  routine_type text := new.recurrence_rule ->> 'routineType';
  linked_record public.records%rowtype;
  land_type text;
begin
  if routine_type is null then return new; end if;
  if routine_type not in (
    'milk_morning', 'milk_evening', 'egg_collection',
    'animal_condition_check', 'animal_hoof_check', 'animal_health_check',
    'pasture_boundary_inspection', 'pasture_condition_check', 'pasture_mow',
    'garden_inspection', 'garden_weed', 'garden_water_check',
    'orchard_inspection', 'orchard_ground_maintenance', 'orchard_tree_check',
    'field_inspection', 'field_access_readiness', 'woodlot_inspection', 'water_condition_observation',
    'equipment_inspect', 'equipment_service', 'equipment_storage',
    'structure_inspect', 'structure_clean', 'structure_seasonal_check'
  ) then raise exception 'Unsupported Routine type' using errcode = '23514'; end if;
  if new.record_id is null or coalesce(new.due_date, new.available_from) is null
     or coalesce(new.recurrence_rule ->> 'frequency', '') not in ('daily', 'weekly', 'monthly') then
    if routine_type in ('milk_morning', 'milk_evening', 'egg_collection') then
      raise exception 'Routines require a recurring task, eligible Animal, and task date' using errcode = '23514';
    end if;
    raise exception 'Routines require an eligible Record, date, and supported recurrence' using errcode = '23514';
  end if;
  select * into linked_record from public.records where id = new.record_id;
  if not found or linked_record.homestead_id is distinct from new.homestead_id or linked_record.deleted_at is not null then
    raise exception 'Routines require an active Record in this Homestead' using errcode = '23514';
  end if;
  land_type := lower(coalesce(linked_record.identity ->> 'landType', linked_record.identity ->> 'land_type', ''));
  if routine_type in ('milk_morning', 'milk_evening') and (linked_record.type <> 'animal' or lower(coalesce(linked_record.identity ->> 'purpose', '')) <> 'dairy') then
    raise exception 'Routine type does not match the Animal purpose' using errcode = '23514';
  elsif routine_type = 'egg_collection' and (linked_record.type <> 'animal' or lower(coalesce(linked_record.identity ->> 'purpose', '')) <> 'eggs') then
    raise exception 'Routine type does not match the Animal purpose' using errcode = '23514';
  elsif routine_type like 'animal_%' and linked_record.type <> 'animal' then
    raise exception 'Animal care Routine requires an Animal' using errcode = '23514';
  elsif routine_type like 'equipment_%' and linked_record.type <> 'equipment' then
    raise exception 'Equipment Routine requires Equipment' using errcode = '23514';
  elsif routine_type like 'structure_%' and linked_record.type <> 'structure' then
    raise exception 'Structure Routine requires a Structure' using errcode = '23514';
  elsif routine_type like 'pasture_%' and (linked_record.type <> 'land' or land_type <> 'pasture') then
    raise exception 'Pasture Routine requires Pasture Land' using errcode = '23514';
  elsif routine_type like 'garden_%' and (linked_record.type <> 'land' or land_type <> 'garden plot') then
    raise exception 'Garden Routine requires Garden Plot Land' using errcode = '23514';
  elsif routine_type like 'orchard_%' and (linked_record.type <> 'land' or land_type <> 'orchard') then
    raise exception 'Orchard Routine requires Orchard Land' using errcode = '23514';
  elsif routine_type like 'field_%' and (linked_record.type <> 'land' or land_type <> 'hay field') then
    raise exception 'Field Routine requires Hay Field Land' using errcode = '23514';
  elsif routine_type = 'woodlot_inspection' and (linked_record.type <> 'land' or land_type <> 'woodlot') then
    raise exception 'Woodlot Routine requires Woodlot Land' using errcode = '23514';
  elsif routine_type = 'water_condition_observation' and (linked_record.type <> 'land' or land_type not in ('pond', 'wetland')) then
    raise exception 'Water observation requires Pond or Wetland Land' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function private.copy_recurring_task_assignments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_task_id is null then return new; end if;
  insert into public.task_assignments (homestead_id, task_id, person_id, member_id, assignment_type, assigned_by, assigned_at)
  select new.homestead_id, new.id, a.person_id, a.member_id, a.assignment_type, new.created_by, now()
  from public.task_assignments a
  where a.task_id = new.parent_task_id and a.removed_at is null
  on conflict do nothing;
  return new;
end $$;

create trigger copy_recurring_task_assignments
  after insert on public.tasks
  for each row execute function private.copy_recurring_task_assignments();

revoke execute on function private.validate_record_relationship_v2() from public, anon, authenticated;
revoke execute on function private.validate_record_responsibility_v2() from public, anon, authenticated;
revoke execute on function private.copy_recurring_task_assignments() from public, anon, authenticated;
