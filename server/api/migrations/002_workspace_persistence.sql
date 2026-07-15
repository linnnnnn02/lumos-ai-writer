alter table public.projects
add column if not exists active_conversation_id uuid;

alter table public.conversations
add column if not exists last_opened_at timestamptz not null default now();

alter table public.conversations
add column if not exists state jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_active_conversation_id_fkey'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
    add constraint projects_active_conversation_id_fkey
    foreign key (active_conversation_id)
    references public.conversations(id)
    on delete set null;
  end if;
end;
$$;

create table if not exists public.feedback_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  draft_id uuid references public.drafts(id) on delete set null,
  type text not null check (
    type in ('like', 'dislike', 'rewrite_preference', 'ai_smell_feedback', 'final_choice')
  ),
  content text not null,
  context jsonb not null default '{}'::jsonb,
  source text not null default 'explicit_user_action',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists projects_user_id_updated_at_idx
on public.projects(user_id, updated_at desc)
where deleted_at is null;

create index if not exists conversations_project_last_opened_idx
on public.conversations(project_id, pinned desc, last_opened_at desc)
where deleted_at is null;

create index if not exists feedback_memories_user_created_at_idx
on public.feedback_memories(user_id, created_at desc)
where deleted_at is null;

create index if not exists feedback_memories_conversation_idx
on public.feedback_memories(conversation_id, created_at desc)
where deleted_at is null;

drop trigger if exists feedback_memories_set_updated_at on public.feedback_memories;
create trigger feedback_memories_set_updated_at
before update on public.feedback_memories
for each row execute function public.set_updated_at();

alter table public.feedback_memories enable row level security;

drop policy if exists "feedback memories owner access" on public.feedback_memories;
create policy "feedback memories owner access" on public.feedback_memories
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);
