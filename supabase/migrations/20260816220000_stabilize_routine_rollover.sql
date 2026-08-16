-- Stabilization sprint: old unfinished Routine occurrences are closed as missed
-- so Today only presents the current day's work.

alter table public.routine_occurrences
  drop constraint if exists routine_occurrences_completion_method_check;

alter table public.routine_occurrences
  add constraint routine_occurrences_completion_method_check
  check (completion_method in ('ordinary','yield','without_yield','migration','rollover') or completion_method is null);

create or replace function private.advance_routine_occurrence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare linked public.routines%rowtype; next_day date;
begin
  if old.status <> 'pending' or new.status = 'pending' then return new; end if;

  -- A rollover marks an unfinished historical occurrence as missed. The client
  -- materializes the currently due occurrence separately, so advancing from the
  -- stale date here would recreate yesterday's work and make Today noisy again.
  if new.status = 'skipped' and new.completion_method = 'rollover' then
    return new;
  end if;

  select * into linked from public.routines where id = new.routine_id and deleted_at is null for update;
  if not found or not linked.enabled then return new; end if;
  next_day := case linked.frequency
    when 'daily' then new.occurrence_date + linked.interval
    when 'weekly' then new.occurrence_date + (7 * linked.interval)
    when 'monthly' then (new.occurrence_date + make_interval(months => linked.interval))::date end;
  insert into public.routine_occurrences (homestead_id, routine_id, occurrence_date, created_by, updated_by, source)
    values (linked.homestead_id, linked.id, next_day, new.completed_by, new.completed_by, 'system') on conflict do nothing;
  update public.routines set next_date = next_day, updated_by = new.completed_by where id = linked.id and next_date < next_day;
  return new;
end $$;

revoke execute on function private.advance_routine_occurrence() from public, anon, authenticated;
