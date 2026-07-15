alter table public.feedback_memories
drop constraint if exists feedback_memories_type_check;

alter table public.feedback_memories
add constraint feedback_memories_type_check check (
  type in (
    'like',
    'dislike',
    'rewrite_preference',
    'manual_edit',
    'accepted_rewrite',
    'rejected_rewrite',
    'profile_correction',
    'ai_smell_feedback',
    'final_choice'
  )
);

create table if not exists public.writing_profile_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('account', 'project')),
  project_id uuid references public.projects(id) on delete cascade,
  version integer not null check (version > 0),
  profile jsonb not null,
  evidence_ids text[] not null default '{}',
  skill_id text not null,
  skill_version text not null,
  prompt_hash text not null,
  created_at timestamptz not null default now(),
  check (
    (scope = 'account' and project_id is null)
    or (scope = 'project' and project_id is not null)
  )
);

create unique index if not exists writing_profile_account_version_idx
on public.writing_profile_revisions(user_id, version)
where scope = 'account';

create unique index if not exists writing_profile_project_version_idx
on public.writing_profile_revisions(user_id, project_id, version)
where scope = 'project';

create index if not exists writing_profile_latest_idx
on public.writing_profile_revisions(user_id, scope, project_id, version desc);

alter table public.writing_profile_revisions enable row level security;

drop policy if exists "writing profile revisions owner access"
on public.writing_profile_revisions;

create policy "writing profile revisions owner access"
on public.writing_profile_revisions
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);
