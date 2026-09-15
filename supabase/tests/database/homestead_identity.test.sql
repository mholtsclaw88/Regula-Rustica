begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_column('public','homesteads','motto','Homesteads support an optional motto');
select has_column('public','homesteads','location','Homesteads support a short location');
select has_column('public','homesteads','logo_storage_path','Homesteads reference one shared logo object');
select has_column('public','homesteads','logo_crop','Homesteads store shared non-destructive logo framing');
select col_type_is('public','homesteads','motto','text','Motto is plain text');
select col_type_is('public','homesteads','location','text','Location is plain text');
select col_type_is('public','homesteads','logo_storage_path','text','Logo reference is a Storage path');
select col_type_is('public','homesteads','logo_crop','jsonb','Logo framing is structured presentation metadata');
select ok(has_column_privilege('authenticated','public.homesteads','motto','UPDATE'),'Authenticated role may update motto subject to Homestead RLS');
select ok(has_column_privilege('authenticated','public.homesteads','location','UPDATE'),'Authenticated role may update location subject to Homestead RLS');
select ok(has_column_privilege('authenticated','public.homesteads','logo_storage_path','UPDATE'),'Authenticated role may update logo path subject to Homestead RLS');
select ok(has_column_privilege('authenticated','public.homesteads','logo_crop','UPDATE'),'Authenticated role may update logo framing subject to Homestead RLS');

select * from finish();
rollback;
