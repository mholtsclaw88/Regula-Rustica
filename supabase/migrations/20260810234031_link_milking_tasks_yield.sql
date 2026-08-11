-- Explicitly link record-specific Routines to their canonical Yield.
-- The Routine type remains part of the structured recurrence rule so it
-- is inherited by the next occurrence through the existing recurrence path.

alter table public.yield_entries
  add column task_id uuid references public.tasks(id) on delete restrict;

alter table public.yield_entries
  add constraint yield_entries_one_per_task unique (task_id);

create unique index tasks_one_active_routine_per_animal
  on public.tasks (homestead_id, record_id, (recurrence_rule ->> 'routineType'))
  where deleted_at is null and status in ('open', 'in_progress')
    and recurrence_rule ->> 'routineType' in ('milk_morning', 'milk_evening', 'egg_collection');

create or replace function private.validate_routine_task_configuration()
returns trigger language plpgsql set search_path = '' as $$
declare
  routine_type text := new.recurrence_rule ->> 'routineType';
  linked_record public.records%rowtype;
begin
  if routine_type is null then return new; end if;
  if routine_type not in ('milk_morning', 'milk_evening', 'egg_collection') then
    raise exception 'Unsupported Routine type' using errcode = '23514';
  end if;
  if new.recurrence_rule is null or new.record_id is null or coalesce(new.due_date, new.available_from) is null then
    raise exception 'Routines require a recurring task, eligible Animal, and task date' using errcode = '23514';
  end if;
  select * into linked_record from public.records where id = new.record_id;
  if not found or linked_record.homestead_id is distinct from new.homestead_id
     or linked_record.type <> 'animal'
     or linked_record.deleted_at is not null then
    raise exception 'Routines require an active Animal in this Homestead' using errcode = '23514';
  end if;
  if (routine_type in ('milk_morning', 'milk_evening') and lower(coalesce(linked_record.identity ->> 'purpose', '')) <> 'dairy')
     or (routine_type = 'egg_collection' and lower(coalesce(linked_record.identity ->> 'purpose', '')) <> 'eggs') then
    raise exception 'Routine type does not match the Animal purpose' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function private.validate_yield_task_link()
returns trigger language plpgsql set search_path = '' as $$
declare
  linked_task public.tasks%rowtype;
  homestead_timezone text;
  routine_type text;
  yield_date date;
begin
  -- The established housekeeping RPC carries new fields inside details.
  -- Promote that transport value into the canonical foreign key.
  if new.task_id is null and new.details ? 'task_id' and new.details ->> 'task_id' is not null then
    new.task_id := (new.details ->> 'task_id')::uuid;
  end if;
  new.details := new.details - 'task_id';

  if tg_op = 'UPDATE' and old.task_id is not null and new.task_id is distinct from old.task_id then
    raise exception 'A Yield cannot be relinked from its completed Task' using errcode = '23514';
  end if;
  if new.task_id is null then return new; end if;

  select * into linked_task from public.tasks where id = new.task_id;
  if not found or linked_task.homestead_id is distinct from new.homestead_id then
    raise exception 'Task belongs to another Homestead' using errcode = '23503';
  end if;
  routine_type := linked_task.recurrence_rule ->> 'routineType';
  select h.timezone into homestead_timezone from public.homesteads h where h.id = new.homestead_id;
  yield_date := (new.occurred_at at time zone coalesce(homestead_timezone, 'America/New_York'))::date;
  if linked_task.record_id is distinct from new.record_id
     or coalesce(linked_task.due_date, linked_task.available_from) is distinct from yield_date
     or (routine_type = 'milk_morning' and (new.yield_type <> 'milk' or new.session <> 'morning'))
     or (routine_type = 'milk_evening' and (new.yield_type <> 'milk' or new.session <> 'evening'))
     or (routine_type = 'egg_collection' and (new.yield_type <> 'eggs' or new.session <> 'other'))
     or routine_type is null or routine_type not in ('milk_morning', 'milk_evening', 'egg_collection') then
    raise exception 'Yield does not match the linked Routine' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function private.complete_task_from_yield()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  current_task public.tasks%rowtype;
  base_date date;
  next_due date;
  every_n integer;
begin
  if new.task_id is null then return new; end if;
  if tenant is null or tenant is distinct from new.homestead_id or not public.has_capability('complete_tasks') then
    raise exception 'Not authorized to complete the linked Task' using errcode = '42501';
  end if;
  select * into current_task from public.tasks
    where id = new.task_id and homestead_id = tenant and deleted_at is null for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if public.current_member_role() = 'hand' and not exists (
    select 1 from public.task_assignments a
    join public.homestead_members m on m.id = a.member_id
    where a.task_id = current_task.id and a.homestead_id = tenant and a.removed_at is null
      and m.user_id = actor and m.status = 'active'
  ) then
    raise exception 'Task is not assigned to this member' using errcode = '42501';
  end if;
  if current_task.status = 'completed' then return new; end if;

  perform set_config('regula.allow_task_completion', 'true', true);
  update public.tasks set status = 'completed', completed_at = now(), completed_by = actor, updated_by = actor
    where id = current_task.id;

  if current_task.recurrence_rule is not null then
    every_n := greatest(coalesce((current_task.recurrence_rule ->> 'interval')::integer, 1), 1);
    base_date := case when current_task.recurrence_rule ->> 'mode' = 'after_completion'
      then current_date else coalesce(current_task.due_date, current_date) end;
    next_due := case current_task.recurrence_rule ->> 'frequency'
      when 'daily' then base_date + every_n
      when 'weekly' then base_date + (7 * every_n)
      when 'monthly' then (base_date + make_interval(months => every_n))::date
      else null end;
    if next_due is null then raise exception 'Unsupported recurrence frequency' using errcode = '22023'; end if;
    insert into public.tasks (
      homestead_id, record_id, parent_task_id, title, description, status, priority,
      due_date, recurrence_rule, created_by, updated_by, source
    ) values (
      tenant, current_task.record_id, current_task.id, current_task.title, current_task.description,
      'open', current_task.priority, next_due, current_task.recurrence_rule, actor, actor, 'system'
    );
  end if;
  return new;
end $$;

create trigger validate_routine_task_configuration
  before insert or update on public.tasks
  for each row execute function private.validate_routine_task_configuration();

-- This trigger is created after the existing Homestead validator so the
-- canonical task_id is available to completion and auditing triggers.
create trigger validate_yield_task_link
  before insert or update on public.yield_entries
  for each row execute function private.validate_yield_task_link();

create trigger complete_task_from_yield
  after insert on public.yield_entries
  for each row execute function private.complete_task_from_yield();

revoke execute on function private.validate_routine_task_configuration() from public, anon, authenticated;
revoke execute on function private.validate_yield_task_link() from public, anon, authenticated;
revoke execute on function private.complete_task_from_yield() from public, anon, authenticated;
