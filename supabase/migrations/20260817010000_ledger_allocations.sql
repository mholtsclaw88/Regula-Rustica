-- Ledger allocation sprint: distribute one transaction across multiple Records.

create table public.ledger_allocations (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  ledger_entry_id uuid not null references public.ledger_entries(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);

create unique index ledger_allocations_one_record_per_entry_idx
  on public.ledger_allocations (ledger_entry_id, record_id) where deleted_at is null;
create index ledger_allocations_sync_cursor_idx on public.ledger_allocations (homestead_id, updated_at, id);
create index ledger_allocations_record_idx on public.ledger_allocations (homestead_id, record_id) where deleted_at is null;

create or replace function private.validate_ledger_allocation()
returns trigger language plpgsql set search_path = '' as $$
declare entry_tenant uuid; record_tenant uuid; entry_amount numeric; allocated numeric;
begin
  select homestead_id, amount into entry_tenant, entry_amount from public.ledger_entries where id = new.ledger_entry_id and deleted_at is null;
  select homestead_id into record_tenant from public.records where id = new.record_id and deleted_at is null;
  if entry_tenant is distinct from new.homestead_id then raise exception 'Ledger entry belongs to another Homestead' using errcode='23514'; end if;
  if record_tenant is distinct from new.homestead_id then raise exception 'Record belongs to another Homestead' using errcode='23514'; end if;
  select coalesce(sum(amount),0) into allocated from public.ledger_allocations
    where ledger_entry_id=new.ledger_entry_id and deleted_at is null and id<>new.id;
  if allocated + new.amount > entry_amount then raise exception 'Ledger allocations cannot exceed the transaction amount' using errcode='23514'; end if;
  return new;
end $$;

create trigger validate_ledger_allocation before insert or update on public.ledger_allocations
  for each row execute function private.validate_ledger_allocation();
create trigger touch_ledger_allocations before update on public.ledger_allocations
  for each row execute function private.touch_row();
create trigger protect_ledger_allocations before insert or update on public.ledger_allocations
  for each row execute function private.protect_common_fields();
create trigger audit_ledger_allocations after insert or update on public.ledger_allocations
  for each row execute function private.audit_row();

alter table public.ledger_allocations enable row level security;
create policy ledger_allocations_select on public.ledger_allocations for select to authenticated
  using (homestead_id = public.current_homestead_id());
create policy ledger_allocations_insert on public.ledger_allocations for insert to authenticated
  with check (homestead_id = public.current_homestead_id() and public.has_capability('manage_ledger'));
create policy ledger_allocations_update on public.ledger_allocations for update to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('manage_ledger'))
  with check (homestead_id = public.current_homestead_id() and public.has_capability('manage_ledger'));

grant select, insert, update on public.ledger_allocations to authenticated;

create or replace function public.apply_ledger_allocation_sync_operation(operation_key text, client_device_id uuid, target_table text, target_id uuid, operation_kind text, expected_version integer, client_timestamp timestamptz, operation_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_user(); tenant uuid:=public.current_homestead_id(); request_digest text; prior public.sync_operations%rowtype; current_row jsonb; result jsonb;
begin
  if tenant is null or target_table <> 'ledger_allocations' or operation_kind not in ('create','update','soft_delete','restore') then raise exception 'Unsupported Ledger allocation sync operation' using errcode='22023'; end if;
  if not public.has_capability('manage_ledger') then raise exception 'Not authorized' using errcode='42501'; end if;
  if operation_key is null or client_device_id is null or target_id is null then raise exception 'Sync identity is required' using errcode='22023'; end if;
  operation_payload:=coalesce(operation_payload,'{}'::jsonb);
  request_digest:=encode(extensions.digest(concat_ws(':',client_device_id,target_table,target_id,operation_kind,coalesce(expected_version::text,''),coalesce(client_timestamp::text,''),operation_payload::text),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':',tenant,actor,operation_key),0));
  select * into prior from public.sync_operations where homestead_id=tenant and user_id=actor and idempotency_key=operation_key for update;
  if found then if prior.request_hash is distinct from request_digest then raise exception 'Idempotency key was reused for a different request' using errcode='22023'; end if; return prior.response; end if;
  if operation_kind='create' then
    insert into public.ledger_allocations(id,homestead_id,ledger_entry_id,record_id,amount,created_by,updated_by,client_updated_at)
    values(target_id,tenant,(operation_payload->>'ledger_entry_id')::uuid,(operation_payload->>'record_id')::uuid,(operation_payload->>'amount')::numeric,actor,actor,client_timestamp)
    on conflict(id) do nothing returning to_jsonb(ledger_allocations.*) into current_row;
  else
    if expected_version is null then raise exception 'Expected version is required' using errcode='22023'; end if;
    if operation_kind in ('soft_delete','restore') then
      perform set_config('regula.allow_deleted_state','true',true);
      update public.ledger_allocations set deleted_at=case when operation_kind='restore' then null else now() end,deleted_by=case when operation_kind='restore' then null else actor end,updated_by=actor,client_updated_at=client_timestamp
      where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(ledger_allocations.*) into current_row;
    else
      update public.ledger_allocations set ledger_entry_id=(operation_payload->>'ledger_entry_id')::uuid,record_id=(operation_payload->>'record_id')::uuid,amount=(operation_payload->>'amount')::numeric,updated_by=actor,client_updated_at=client_timestamp
      where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(ledger_allocations.*) into current_row;
    end if;
  end if;
  if current_row is null then select to_jsonb(a.*) into current_row from public.ledger_allocations a where a.id=target_id and a.homestead_id=tenant; result:=jsonb_build_object('status','conflict','row',current_row); else result:=jsonb_build_object('status','applied','row',current_row); end if;
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,response,processed_at)
  values(tenant,actor,client_device_id,operation_key,operation_kind,target_table,target_id,request_digest,'processed',result,now());
  return result;
end $$;

revoke all on function public.apply_ledger_allocation_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) from public, anon;
grant execute on function public.apply_ledger_allocation_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) to authenticated;
