begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column('public','chore_windows','start_time','Chore Windows have an optional start time');
select has_column('public','chore_windows','end_time','Chore Windows have an optional end time');
select col_type_is('public','chore_windows','start_time','time without time zone','start time uses a local wall-clock value');
select col_type_is('public','chore_windows','end_time','time without time zone','end time uses a local wall-clock value');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.chore_windows'::regclass and conname='chore_windows_time_order_check') like '%end_time >= start_time%',
  'Chore Window end time cannot precede its start time'
);
select has_index('public','tasks','tasks_recurrence_series_date_unique_idx','recurring Task dates have a series uniqueness index');
select ok(
  (select indisunique from pg_index where indexrelid='public.tasks_recurrence_series_date_unique_idx'::regclass),
  'series/date recurrence index is unique'
);
select ok(
  pg_get_functiondef('public.complete_recurring_task(uuid,text,uuid)'::regprocedure) ~ 'recurrence_rule\s*->>\s*''seriesId'''
  and pg_get_functiondef('public.complete_recurring_task(uuid,text,uuid)'::regprocedure) like '%on conflict do nothing%',
  'recurring completion reuses an existing series occurrence safely'
);
select ok(
  pg_get_functiondef('public.apply_task_sync_operation(text,uuid,text,uuid,text,integer,timestamp with time zone,jsonb)'::regprocedure) ~ 'recurrence_rule\s*->>\s*''seriesId'''
  and pg_get_functiondef('public.apply_task_sync_operation(text,uuid,text,uuid,text,integer,timestamp with time zone,jsonb)'::regprocedure) ~ 'due_date\s*=\s*task_due',
  'Task sync resolves concurrent creates by series and date'
);
select ok(
  pg_get_functiondef('public.apply_routine_sync_operation(text,uuid,text,uuid,text,integer,timestamp with time zone,jsonb)'::regprocedure) like '%start_time%'
  and pg_get_functiondef('public.apply_routine_sync_operation(text,uuid,text,uuid,text,integer,timestamp with time zone,jsonb)'::regprocedure) like '%end_time%',
  'Chore Window sync transports both optional times'
);

select * from finish();
rollback;
