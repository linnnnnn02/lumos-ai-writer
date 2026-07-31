alter table public.notes
  add column if not exists learning_status text not null default 'ready',
  add column if not exists quality_flags jsonb not null default '[]'::jsonb,
  add column if not exists learning_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notes_learning_status_check'
      and conrelid = 'public.notes'::regclass
  ) then
    alter table public.notes
      add constraint notes_learning_status_check
      check (learning_status in ('ready', 'pending_review', 'excluded'));
  end if;
end
$$;

create index if not exists notes_user_learning_status_idx
  on public.notes(user_id, learning_status)
  where deleted_at is null;
