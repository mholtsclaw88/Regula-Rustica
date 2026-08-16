begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select like(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.routine_occurrences'::regclass
     and conname = 'routine_occurrences_completion_method_check'),
  '%rollover%',
  'Routine occurrence completion method accepts rollover'
);

select like(
  pg_get_functiondef('private.advance_routine_occurrence()'::regprocedure),
  '%completion_method = ''rollover''%',
  'advance trigger recognizes rollover completion'
);

select like(
  pg_get_functiondef('private.advance_routine_occurrence()'::regprocedure),
  '%return new%',
  'rollover path returns without recreating stale work'
);

select * from finish();
rollback;
