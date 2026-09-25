-- Cloud Sync is a Homestead Premium feature. Local data is unaffected.
-- Existing active Premium grants keep working, including grants issued before
-- cloud_sync became a feature key.
alter table public.premium_entitlements
  alter column feature_keys set default array[
    'cloud_sync',
    'cellarer_assisted_entry',
    'cellarer_receipt_reader',
    'cellarer_ask_farm_book'
  ]::text[];

update public.premium_entitlements
set feature_keys = array_append(feature_keys, 'cloud_sync'), updated_at = now()
where not ('cloud_sync' = any(feature_keys));

-- SECURITY DEFINER sync RPCs bypass table RLS, so guard their writes with a
-- trigger as well as restrictive policies. SQL-editor/service-role maintenance
-- has no end-user auth.uid(); authenticated sync requests always do.
create function private.require_premium_cloud_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
    and not public.has_premium_feature('cloud_sync') then
    raise exception 'Premium is required for Cloud Sync'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke execute on function private.require_premium_cloud_write()
  from public, anon, authenticated;

do $$
declare entity text;
begin
  foreach entity in array array[
    'records', 'record_documents', 'record_attachments',
    'chore_windows', 'tasks', 'record_relationships', 'task_assignments',
    'chronicle_entries', 'calendar_events', 'yield_entries', 'notes',
    'ledger_entries', 'ledger_allocations', 'routines', 'routine_occurrences',
    'sync_operations'
  ] loop
    execute format(
      'create policy premium_cloud_access on public.%I as restrictive for all to authenticated using ((select public.has_premium_feature(''cloud_sync''))) with check ((select public.has_premium_feature(''cloud_sync'')))',
      entity
    );
    execute format(
      'create trigger premium_cloud_write before insert or update or delete on public.%I for each row execute function private.require_premium_cloud_write()',
      entity
    );
  end loop;
end
$$;

-- Identity changes and household invitations are also cloud writes, but
-- account sign-in, Homestead creation, and gift redemption must stay open.
create policy premium_homestead_update on public.homesteads
  as restrictive for update to authenticated
  using ((select public.has_premium_feature('cloud_sync')))
  with check ((select public.has_premium_feature('cloud_sync')));
create trigger premium_homestead_write before update on public.homesteads
  for each row execute function private.require_premium_cloud_write();

create policy premium_invitation_create on public.invitations
  as restrictive for insert to authenticated
  with check ((select public.has_premium_feature('cloud_sync')));
create trigger premium_invitation_write before insert on public.invitations
  for each row execute function private.require_premium_cloud_write();

-- Membership and account management remain available so a Steward can sign
-- in and redeem a gift. Child rows are Farm Book data, not account records.
create policy premium_child_people_access on public.homestead_people
  as restrictive for all to authenticated
  using (person_type <> 'child' or (select public.has_premium_feature('cloud_sync')))
  with check (person_type <> 'child' or (select public.has_premium_feature('cloud_sync')));

create function private.require_premium_child_people_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare touches_child boolean;
begin
  touches_child := case tg_op
    when 'INSERT' then new.person_type = 'child'
    when 'DELETE' then old.person_type = 'child'
    else old.person_type = 'child' or new.person_type = 'child'
  end;
  if (select auth.uid()) is not null
    and touches_child
    and not public.has_premium_feature('cloud_sync') then
    raise exception 'Premium is required for Cloud Sync'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke execute on function private.require_premium_child_people_write()
  from public, anon, authenticated;
create trigger premium_child_people_write before insert or update or delete
  on public.homestead_people for each row
  execute function private.require_premium_child_people_write();

-- Direct Storage API calls must observe the same gate as synced attachments.
create policy premium_record_documents_storage on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'record-documents' or (select public.has_premium_feature('cloud_sync')))
  with check (bucket_id <> 'record-documents' or (select public.has_premium_feature('cloud_sync')));
