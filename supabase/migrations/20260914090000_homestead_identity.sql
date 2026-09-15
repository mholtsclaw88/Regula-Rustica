-- Homestead Identity v1 extends the existing shared Homestead row and private
-- tenant-scoped Storage bucket. It does not participate in domain outbox sync.

alter table public.homesteads
  add column motto text check (motto is null or length(btrim(motto)) <= 160),
  add column location text check (location is null or length(btrim(location)) <= 120),
  add column logo_storage_path text,
  add column logo_crop jsonb not null default '{"x":50,"y":50,"zoom":1}'::jsonb check (
    logo_crop ?& array['x','y','zoom']
    and jsonb_typeof(logo_crop->'x') = 'number'
    and jsonb_typeof(logo_crop->'y') = 'number'
    and jsonb_typeof(logo_crop->'zoom') = 'number'
    and (logo_crop->>'x')::numeric between 0 and 100
    and (logo_crop->>'y')::numeric between 0 and 100
    and (logo_crop->>'zoom')::numeric between 1 and 3
  );

alter table public.homesteads
  add constraint homesteads_logo_storage_path_check check (
    logo_storage_path is null
    or logo_storage_path like 'homesteads/' || id::text || '/identity/%'
  );

grant update (motto, location, logo_storage_path, logo_crop) on public.homesteads to authenticated;
