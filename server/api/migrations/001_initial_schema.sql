create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null,
  filename text not null,
  author_name text,
  source_url text not null,
  normalized_source_url text not null,
  cover_image_url text,
  content_text text,
  source_platform text not null default 'xiaohongshu',
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(user_id, normalized_source_url)
);

create table if not exists public.snippets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  selected_text text not null,
  reason_text text,
  color_value text,
  color_tag_name text,
  start_offset integer,
  end_offset integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.extension_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  device_name text,
  browser text,
  extension_version text,
  refresh_token_hash text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  default_folder_id uuid references public.folders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  step text not null default 'learn',
  pinned boolean not null default false,
  selected_reference_ids jsonb not null default '[]'::jsonb,
  length text,
  topic text,
  target_audience text,
  analysis_ready boolean not null default false,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  channel text not null,
  role text not null,
  content jsonb not null,
  model text,
  ai_run_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  version integer not null,
  title text not null,
  body jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(conversation_id, version)
);

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  task_type text not null,
  provider text not null,
  model text not null,
  status text not null,
  input_token_count integer,
  output_token_count integer,
  cost_estimate_cny numeric,
  latency_ms integer,
  prompt_hash text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists folders_user_id_idx on public.folders(user_id);
create index if not exists notes_user_id_folder_id_idx on public.notes(user_id, folder_id);
create index if not exists snippets_user_id_note_id_idx on public.snippets(user_id, note_id);
create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists conversations_user_id_project_id_idx on public.conversations(user_id, project_id);
create index if not exists chat_messages_conversation_id_idx on public.chat_messages(conversation_id);
create index if not exists drafts_conversation_id_idx on public.drafts(conversation_id);
create index if not exists ai_runs_user_id_created_at_idx on public.ai_runs(user_id, created_at desc);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at
before update on public.folders
for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

drop trigger if exists snippets_set_updated_at on public.snippets;
create trigger snippets_set_updated_at
before update on public.snippets
for each row execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists drafts_set_updated_at on public.drafts;
create trigger drafts_set_updated_at
before update on public.drafts
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.snippets enable row level security;
alter table public.extension_devices enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.drafts enable row level security;
alter table public.ai_runs enable row level security;

drop policy if exists "profiles owner access" on public.profiles;
create policy "profiles owner access" on public.profiles
for all using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "folders owner access" on public.folders;
create policy "folders owner access" on public.folders
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "notes owner access" on public.notes;
create policy "notes owner access" on public.notes
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "snippets owner access" on public.snippets;
create policy "snippets owner access" on public.snippets
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "extension devices owner access" on public.extension_devices;
create policy "extension devices owner access" on public.extension_devices
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "projects owner access" on public.projects;
create policy "projects owner access" on public.projects
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "conversations owner access" on public.conversations;
create policy "conversations owner access" on public.conversations
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "chat messages owner access" on public.chat_messages;
create policy "chat messages owner access" on public.chat_messages
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "drafts owner access" on public.drafts;
create policy "drafts owner access" on public.drafts
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "ai runs owner access" on public.ai_runs;
create policy "ai runs owner access" on public.ai_runs
for all using (auth.uid() = user_id)
with check (auth.uid() = user_id);
