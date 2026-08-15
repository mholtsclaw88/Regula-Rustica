-- Structured Record stewardship relationships for Records v2.
-- Routines remain first-class and are intentionally untouched here.

create unique index if not exists record_relationships_one_current_location_idx
  on public.record_relationships (source_record_id)
  where relationship_type = 'located_on' and deleted_at is null and ended_at is null;

create unique index if not exists record_relationships_one_parent_role_idx
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

  if source_record.id is null or target_record.id is null
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

drop trigger if exists validate_record_relationship_v2 on public.record_relationships;
create trigger validate_record_relationship_v2
  before insert or update on public.record_relationships
  for each row execute function private.validate_record_relationship_v2();

drop trigger if exists validate_record_responsibility_v2 on public.records;
create trigger validate_record_responsibility_v2
  before insert or update on public.records
  for each row execute function private.validate_record_responsibility_v2();

revoke execute on function private.validate_record_relationship_v2() from public, anon, authenticated;
revoke execute on function private.validate_record_responsibility_v2() from public, anon, authenticated;
