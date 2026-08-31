-- Built-in Chore Windows have a Homestead-scoped semantic identity in addition
-- to their UUID. A recovered device must adopt that row instead of failing its
-- local default create against chore_windows_system_unique.
create or replace function public.apply_routine_sync_operation(operation_key text, client_device_id uuid, target_table text, target_id uuid, operation_kind text, expected_version integer, client_timestamp timestamptz, operation_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); tenant uuid := public.current_homestead_id(); request_digest text; prior public.sync_operations%rowtype; current_row jsonb; result jsonb; linked_routine uuid; system_window_key text;
begin
  if tenant is null or target_table not in ('chore_windows','routines','routine_occurrences') or operation_kind not in ('create','update','soft_delete','restore') then raise exception 'Unsupported Routine sync operation' using errcode = '22023'; end if;
  if operation_key is null or client_device_id is null or target_id is null then raise exception 'Sync identity is required' using errcode = '22023'; end if;
  operation_payload := coalesce(operation_payload, '{}'::jsonb);
  if target_table = 'routine_occurrences' then
    linked_routine := coalesce((operation_payload ->> 'routine_id')::uuid, (select routine_id from public.routine_occurrences where id = target_id and homestead_id = tenant));
    if operation_kind = 'create' and not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
    if operation_kind <> 'create' and not public.can_complete_routine(linked_routine) then raise exception 'Not authorized' using errcode = '42501'; end if;
  elsif not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
  request_digest := encode(extensions.digest(concat_ws(':', client_device_id,target_table,target_id,operation_kind,coalesce(expected_version::text,''),coalesce(client_timestamp::text,''),operation_payload::text),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':',tenant,actor,operation_key),0));
  select * into prior from public.sync_operations where homestead_id=tenant and user_id=actor and idempotency_key=operation_key for update;
  if found then if prior.request_hash is distinct from request_digest then raise exception 'Idempotency key was reused for a different request' using errcode='22023'; end if; return prior.response; end if;
  if operation_kind = 'create' then
    if target_table = 'chore_windows' then
      system_window_key := nullif(operation_payload ->> 'system_key', '');
      if system_window_key is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, 'chore_window', system_window_key), 0));
        select to_jsonb(window_row.*) into current_row
        from public.chore_windows window_row
        where window_row.homestead_id = tenant
          and window_row.system_key = system_window_key
          and window_row.deleted_at is null;
      end if;
      if current_row is null then
        insert into public.chore_windows(id,homestead_id,system_key,name,display_order,enabled,daypart,start_time,end_time,created_by,updated_by,client_updated_at)
        values(target_id,tenant,system_window_key,operation_payload->>'name',coalesce((operation_payload->>'display_order')::integer,0),coalesce((operation_payload->>'enabled')::boolean,true),operation_payload->>'daypart',(operation_payload->>'start_time')::time,(operation_payload->>'end_time')::time,actor,actor,client_timestamp) on conflict(id) do nothing returning to_jsonb(chore_windows.*) into current_row;
      end if;
    elsif target_table = 'routines' then
      insert into public.routines(id,homestead_id,record_id,chore_window_id,person_id,name,routine_type,enabled,frequency,interval,first_date,next_date,created_by,updated_by,client_updated_at)
      values(target_id,tenant,(operation_payload->>'record_id')::uuid,(operation_payload->>'chore_window_id')::uuid,(operation_payload->>'person_id')::uuid,operation_payload->>'name',operation_payload->>'routine_type',coalesce((operation_payload->>'enabled')::boolean,true),operation_payload->>'frequency',coalesce((operation_payload->>'interval')::integer,1),(operation_payload->>'first_date')::date,(operation_payload->>'next_date')::date,actor,actor,client_timestamp) on conflict(id) do nothing returning to_jsonb(routines.*) into current_row;
    else
      insert into public.routine_occurrences(id,homestead_id,routine_id,occurrence_date,status,completion_method,completed_at,completed_by,legacy_task_id,created_by,updated_by,client_updated_at)
      values(target_id,tenant,(operation_payload->>'routine_id')::uuid,(operation_payload->>'occurrence_date')::date,coalesce(operation_payload->>'status','pending'),operation_payload->>'completion_method',(operation_payload->>'completed_at')::timestamptz,case when operation_payload->>'status' in ('completed','skipped') then actor end,(operation_payload->>'legacy_task_id')::uuid,actor,actor,client_timestamp) on conflict(id) do nothing returning to_jsonb(routine_occurrences.*) into current_row;
    end if;
  else
    if expected_version is null then raise exception 'Expected version is required' using errcode='22023'; end if;
    if operation_kind in ('soft_delete','restore') then perform set_config('regula.allow_deleted_state','true',true); execute format('update public.%I t set deleted_at=$1,deleted_by=$2,updated_by=$2,client_updated_at=$3 where id=$4 and homestead_id=$5 and version=$6 returning to_jsonb(t.*)',target_table) into current_row using case when operation_kind='restore' then null else now() end,case when operation_kind='restore' then null else actor end,client_timestamp,target_id,tenant,expected_version;
    elsif target_table = 'chore_windows' then update public.chore_windows set system_key=operation_payload->>'system_key',name=operation_payload->>'name',display_order=coalesce((operation_payload->>'display_order')::integer,0),enabled=coalesce((operation_payload->>'enabled')::boolean,true),daypart=operation_payload->>'daypart',start_time=(operation_payload->>'start_time')::time,end_time=(operation_payload->>'end_time')::time,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(chore_windows.*) into current_row;
    elsif target_table = 'routines' then update public.routines set record_id=(operation_payload->>'record_id')::uuid,chore_window_id=(operation_payload->>'chore_window_id')::uuid,person_id=(operation_payload->>'person_id')::uuid,name=operation_payload->>'name',routine_type=operation_payload->>'routine_type',enabled=coalesce((operation_payload->>'enabled')::boolean,true),frequency=operation_payload->>'frequency',interval=coalesce((operation_payload->>'interval')::integer,1),first_date=(operation_payload->>'first_date')::date,next_date=(operation_payload->>'next_date')::date,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(routines.*) into current_row;
    else perform set_config('regula.allow_routine_completion','true',true); update public.routine_occurrences set status=operation_payload->>'status',completion_method=operation_payload->>'completion_method',completed_at=(operation_payload->>'completed_at')::timestamptz,completed_by=case when operation_payload->>'status' in ('completed','skipped') then actor end,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(routine_occurrences.*) into current_row;
    end if;
  end if;
  if current_row is null then execute format('select to_jsonb(t.*) from public.%I t where t.id=$1 and t.homestead_id=$2',target_table) into current_row using target_id,tenant; result:=jsonb_build_object('status','conflict','row',current_row); else result:=jsonb_build_object('status','applied','row',current_row); end if;
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,response,processed_at) values(tenant,actor,client_device_id,operation_key,operation_kind,target_table,target_id,request_digest,'processed',result,now());
  return result;
end $$;

revoke execute on function public.apply_routine_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) from public,anon;
grant execute on function public.apply_routine_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) to authenticated;
