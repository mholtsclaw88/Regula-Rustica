begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select has_table('public','record_documents','Record documents table exists');
select has_table('public','record_attachments','Record attachments table exists');
select has_column('public','records','primary_photo_id','Records retain one profile photo reference');
select has_column('public','record_documents','record_id','Document entries belong to Records');
select has_column('public','record_attachments','document_id','Attachments belong to document entries');
select has_column('public','record_attachments','storage_path','Attachment metadata stores a Storage path');
select ok((select relrowsecurity from pg_class where oid='public.record_documents'::regclass),'Record documents use RLS');
select ok((select relrowsecurity from pg_class where oid='public.record_attachments'::regclass),'Record attachments use RLS');
select ok(exists(select 1 from storage.buckets where id='record-documents'),'private Record documents bucket exists');
select ok(not (select public from storage.buckets where id='record-documents'),'Record documents bucket is private');
select is((select file_size_limit from storage.buckets where id='record-documents'),10485760::bigint,'bucket limits files to 10 MB');
select has_function('public','apply_document_sync_operation',array['text','uuid','text','uuid','text','integer','timestamp with time zone','jsonb'],'Document sync RPC exists');
select ok(pg_get_functiondef('public.apply_document_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb)'::regprocedure) like '%public.current_homestead_id()%','Document sync derives its tenant server-side');
select ok(pg_get_functiondef('public.apply_document_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb)'::regprocedure) like '%upload_photos%','Attachment creation checks the photo-upload capability');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='record_documents' and policyname='record_documents_select'),'Document SELECT policy exists');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='record_attachments' and policyname='record_attachments_select'),'Attachment SELECT policy exists');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='record_documents_storage_select'),'Storage SELECT policy exists');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='record_documents_storage_insert'),'Storage INSERT policy exists');
select ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='record_documents_storage_delete'),'Storage DELETE policy exists');
select ok((select qual from pg_policies where schemaname='storage' and tablename='objects' and policyname='record_documents_storage_select') like '%current_homestead_id%','Storage reads are tenant-scoped');
select ok(exists(select 1 from pg_trigger where tgrelid='public.record_documents'::regclass and tgname='audit_record_documents' and not tgisinternal),'Document changes are audited');
select ok(exists(select 1 from pg_trigger where tgrelid='public.record_attachments'::regclass and tgname='clear_deleted_profile_photo' and not tgisinternal),'Deleting a profile attachment clears the Record reference');

select * from finish();
rollback;
