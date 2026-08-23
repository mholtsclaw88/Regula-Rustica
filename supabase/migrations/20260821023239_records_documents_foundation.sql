-- Records UI + Journal/Documents foundation.
-- Binary payloads remain in a private Storage bucket; application tables hold metadata only.

create table public.record_documents (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  title text check (title is null or length(title) <= 240),
  body text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);

create table public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  document_id uuid not null references public.record_documents(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  storage_bucket text not null default 'record-documents' check (storage_bucket = 'record-documents'),
  storage_path text not null unique check (length(btrim(storage_path)) > 0),
  file_name text not null check (length(btrim(file_name)) between 1 and 500),
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/gif')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);

create index record_documents_sync_idx on public.record_documents (homestead_id, updated_at, id);
create index record_documents_record_idx on public.record_documents (record_id, updated_at desc) where deleted_at is null;
create index record_attachments_sync_idx on public.record_attachments (homestead_id, updated_at, id);
create index record_attachments_document_idx on public.record_attachments (document_id, created_at) where deleted_at is null;

create or replace function private.validate_record_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.records r where r.id = new.record_id and r.homestead_id = new.homestead_id) then
    raise exception 'Document Record must belong to the same Homestead' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function private.validate_record_attachment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.record_documents d
    where d.id = new.document_id and d.record_id = new.record_id and d.homestead_id = new.homestead_id
  ) then raise exception 'Attachment Document and Record must belong to the same Homestead' using errcode = '23514'; end if;
  return new;
end $$;

create or replace function private.validate_primary_photo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.primary_photo_id is not null and not exists (
    select 1 from public.record_attachments a
    where a.id = new.primary_photo_id and a.record_id = new.id and a.homestead_id = new.homestead_id
      and a.deleted_at is null and a.mime_type like 'image/%'
  ) and new.source <> 'migration' then
    raise exception 'Profile photo must be an active image attached to this Record' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function private.clear_deleted_profile_photo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.records set primary_photo_id = null
    where id = new.record_id and homestead_id = new.homestead_id and primary_photo_id = new.id;
  end if;
  return new;
end $$;

create trigger validate_record_document before insert or update on public.record_documents
  for each row execute function private.validate_record_document();
create trigger validate_record_attachment before insert or update on public.record_attachments
  for each row execute function private.validate_record_attachment();
create trigger validate_primary_photo before insert or update of primary_photo_id on public.records
  for each row execute function private.validate_primary_photo();
create trigger clear_deleted_profile_photo after update of deleted_at on public.record_attachments
  for each row execute function private.clear_deleted_profile_photo();
create trigger touch_record_documents before update on public.record_documents
  for each row execute function private.touch_row();
create trigger touch_record_attachments before update on public.record_attachments
  for each row execute function private.touch_row();
create trigger audit_record_documents after insert or update on public.record_documents
  for each row execute function private.audit_row();
create trigger audit_record_attachments after insert or update on public.record_attachments
  for each row execute function private.audit_row();
create trigger protect_content_record_documents before insert or update on public.record_documents
  for each row execute function private.protect_content_fields();
create trigger protect_content_record_attachments before insert or update on public.record_attachments
  for each row execute function private.protect_content_fields();

-- Role intent already permits ordinary photo observations for Keepers and Hands.
create or replace function public.has_capability(capability text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case public.current_member_role()
    when 'steward' then capability = any (array[
      'view_records','create_records','edit_records','archive_records','restore_records',
      'create_tasks','assign_tasks','complete_tasks','record_events','edit_recent_events',
      'add_notes','edit_notes','view_ledger','manage_ledger','upload_photos',
      'manage_members','manage_homestead','export_data','manage_backups','use_cellarer'])
    when 'keeper' then capability = any (array[
      'view_records','create_records','edit_records','archive_records','restore_records',
      'create_tasks','assign_tasks','complete_tasks','record_events','edit_recent_events',
      'add_notes','edit_notes','view_ledger','manage_ledger','upload_photos','export_data','manage_backups'])
    when 'hand' then capability = any (array['view_records','complete_tasks','record_events','add_notes','upload_photos'])
    when 'guest' then capability = 'view_records'
    else false
  end
$$;

alter table public.record_documents enable row level security;
alter table public.record_attachments enable row level security;

create policy record_documents_select on public.record_documents for select to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy record_documents_insert on public.record_documents for insert to authenticated
  with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('add_notes'));
create policy record_documents_update on public.record_documents for update to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('edit_notes'))
  with check (homestead_id = public.current_homestead_id() and public.has_capability('edit_notes'));
create policy record_attachments_select on public.record_attachments for select to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy record_attachments_insert on public.record_attachments for insert to authenticated
  with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('upload_photos'));
create policy record_attachments_update on public.record_attachments for update to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('edit_notes'))
  with check (homestead_id = public.current_homestead_id() and public.has_capability('edit_notes'));

revoke all on public.record_documents, public.record_attachments from public, anon, authenticated;
grant select, insert, update on public.record_documents, public.record_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('record-documents', 'record-documents', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy record_documents_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'record-documents' and (storage.foldername(name))[1] = 'homesteads'
  and (storage.foldername(name))[2] = public.current_homestead_id()::text
  and public.has_capability('view_records')
);
create policy record_documents_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'record-documents' and (storage.foldername(name))[1] = 'homesteads'
  and (storage.foldername(name))[2] = public.current_homestead_id()::text
  and owner_id = (select auth.uid())::text and public.has_capability('upload_photos')
);
create policy record_documents_storage_delete on storage.objects for delete to authenticated using (
  bucket_id = 'record-documents' and (storage.foldername(name))[1] = 'homesteads'
  and (storage.foldername(name))[2] = public.current_homestead_id()::text
  and public.has_capability('edit_notes')
);

create or replace function public.apply_document_sync_operation(
  operation_key text, client_device_id uuid, target_table text, target_id uuid,
  operation_kind text, expected_version integer, client_timestamp timestamptz, operation_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_user(); tenant uuid := public.current_homestead_id();
  request_digest text; prior public.sync_operations%rowtype; current_row jsonb; result jsonb;
  required_capability text; source_value public.entry_source;
begin
  if tenant is null or target_table not in ('records','record_documents','record_attachments')
    or operation_kind not in ('create','update','soft_delete','restore') then
    raise exception 'Unsupported Document sync operation' using errcode = '22023';
  end if;
  if operation_key is null or length(btrim(operation_key)) = 0 or client_device_id is null or target_id is null then
    raise exception 'Sync identity is required' using errcode = '22023';
  end if;
  operation_payload := coalesce(operation_payload, '{}'::jsonb);
  request_digest := encode(extensions.digest(concat_ws(':', client_device_id, target_table, target_id, operation_kind,
    coalesce(expected_version::text,''), coalesce(client_timestamp::text,''), operation_payload::text), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, actor, operation_key), 0));
  select * into prior from public.sync_operations where homestead_id = tenant and user_id = actor and idempotency_key = operation_key for update;
  if found then
    if prior.request_hash is distinct from request_digest then raise exception 'Idempotency key was reused for a different request' using errcode = '22023'; end if;
    return prior.response;
  end if;
  required_capability := case target_table
    when 'records' then case when operation_kind='create' then 'create_records' when operation_kind='soft_delete' then 'archive_records' when operation_kind='restore' then 'restore_records' else 'edit_records' end
    when 'record_attachments' then case when operation_kind='create' then 'upload_photos' else 'edit_notes' end
    else case when operation_kind='create' then 'add_notes' else 'edit_notes' end end;
  if not public.has_capability(required_capability) then raise exception 'Not authorized' using errcode = '42501'; end if;
  source_value := case when operation_payload ->> 'source' in ('manual','migration','import') then (operation_payload ->> 'source')::public.entry_source else 'manual' end;

  if operation_kind = 'create' then
    if target_table = 'records' then
      insert into public.records(id,homestead_id,type,name,status,identity,stewardship,primary_photo_id,created_by,updated_by,source,client_updated_at)
      values(target_id,tenant,operation_payload->>'type',operation_payload->>'name',operation_payload->>'status',coalesce(operation_payload->'identity','{}'),coalesce(operation_payload->'stewardship','{}'),(operation_payload->>'primary_photo_id')::uuid,actor,actor,source_value,client_timestamp)
      on conflict(id) do nothing returning to_jsonb(records.*) into current_row;
    elsif target_table = 'record_documents' then
      insert into public.record_documents(id,homestead_id,record_id,title,body,created_by,updated_by,source,client_updated_at)
      values(target_id,tenant,(operation_payload->>'record_id')::uuid,operation_payload->>'title',operation_payload->>'body',actor,actor,source_value,client_timestamp)
      on conflict(id) do nothing returning to_jsonb(record_documents.*) into current_row;
    else
      insert into public.record_attachments(id,homestead_id,document_id,record_id,storage_bucket,storage_path,file_name,mime_type,file_size_bytes,created_by,updated_by,source,client_updated_at)
      values(target_id,tenant,(operation_payload->>'document_id')::uuid,(operation_payload->>'record_id')::uuid,'record-documents',operation_payload->>'storage_path',operation_payload->>'file_name',operation_payload->>'mime_type',(operation_payload->>'file_size_bytes')::bigint,actor,actor,source_value,client_timestamp)
      on conflict(id) do nothing returning to_jsonb(record_attachments.*) into current_row;
    end if;
    if current_row is null then execute format('select to_jsonb(t.*) from public.%I t where t.id=$1 and t.homestead_id=$2',target_table) into current_row using target_id,tenant; result:=jsonb_build_object('status','conflict','row',current_row);
    else result:=jsonb_build_object('status','applied','row',current_row); end if;
  else
    if expected_version is null then raise exception 'Expected version is required' using errcode = '22023'; end if;
    if operation_kind in ('soft_delete','restore') then
      perform set_config('regula.allow_deleted_state','true',true);
      execute format('update public.%I t set deleted_at=$1,deleted_by=$2,updated_by=$2,client_updated_at=$3 where id=$4 and homestead_id=$5 and version=$6 returning to_jsonb(t.*)',target_table)
      into current_row using case when operation_kind='restore' then null else now() end,case when operation_kind='restore' then null else actor end,client_timestamp,target_id,tenant,expected_version;
    elsif target_table = 'records' then
      update public.records set type=operation_payload->>'type',name=operation_payload->>'name',status=operation_payload->>'status',identity=coalesce(operation_payload->'identity','{}'),stewardship=coalesce(operation_payload->'stewardship','{}'),primary_photo_id=(operation_payload->>'primary_photo_id')::uuid,updated_by=actor,client_updated_at=client_timestamp
      where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(records.*) into current_row;
    elsif target_table = 'record_documents' then
      update public.record_documents set record_id=(operation_payload->>'record_id')::uuid,title=operation_payload->>'title',body=operation_payload->>'body',updated_by=actor,client_updated_at=client_timestamp
      where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(record_documents.*) into current_row;
    else
      update public.record_attachments set document_id=(operation_payload->>'document_id')::uuid,record_id=(operation_payload->>'record_id')::uuid,storage_path=operation_payload->>'storage_path',file_name=operation_payload->>'file_name',mime_type=operation_payload->>'mime_type',file_size_bytes=(operation_payload->>'file_size_bytes')::bigint,updated_by=actor,client_updated_at=client_timestamp
      where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(record_attachments.*) into current_row;
    end if;
    if current_row is null then execute format('select to_jsonb(t.*) from public.%I t where t.id=$1 and t.homestead_id=$2',target_table) into current_row using target_id,tenant; result:=jsonb_build_object('status','conflict','row',current_row);
    else result:=jsonb_build_object('status','applied','row',current_row); end if;
  end if;
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,response,processed_at)
  values(tenant,actor,client_device_id,operation_key,operation_kind,target_table,target_id,request_digest,'processed',result,now());
  return result;
end $$;

revoke all on function public.apply_document_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) from public,anon;
grant execute on function public.apply_document_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) to authenticated;
revoke execute on function private.validate_record_document(), private.validate_record_attachment(), private.validate_primary_photo(), private.clear_deleted_profile_photo() from public,anon,authenticated;
