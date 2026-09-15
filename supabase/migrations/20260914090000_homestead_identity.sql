-- Homestead Identity v1 extends the existing shared Homestead row and private
-- tenant-scoped Storage bucket. It does not participate in domain outbox sync.

alter table public.homesteads
  add column motto text check (motto is null or length(btrim(motto)) <= 160),
  add column location text check (location is null or length(btrim(location)) <= 120),
  add column logo_storage_path text;

alter table public.homesteads
  add constraint homesteads_logo_storage_path_check check (
    logo_storage_path is null
    or logo_storage_path like 'homesteads/' || id::text || '/identity/%'
  );

grant update (motto, location, logo_storage_path) on public.homesteads to authenticated;
