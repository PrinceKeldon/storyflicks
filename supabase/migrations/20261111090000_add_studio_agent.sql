-- Creator Studio assistant: conversations, messages and approval-gated proposals.
--
-- The assistant never writes manuscript content directly. Every change it wants
-- to make is stored as a proposal that the author must approve; approving one
-- saves a new draft revision through the existing save_creator_episode function.
--
-- These tables are only reachable through the backend (service role), which
-- checks that every row belongs to the signed-in creator.

create table if not exists public.studio_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  story_id uuid references public.stories(id) on delete set null,
  title text not null default 'New conversation' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_agent_conversations_creator_idx
  on public.studio_agent_conversations(creator_id, updated_at desc);

create table if not exists public.studio_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.studio_agent_conversations(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'model')),
  content text not null check (char_length(content) <= 20000),
  tool_activity jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists studio_agent_messages_conversation_idx
  on public.studio_agent_messages(conversation_id, created_at);
-- Supports the per-creator daily message limit.
create index if not exists studio_agent_messages_creator_recent_idx
  on public.studio_agent_messages(creator_id, created_at desc) where role = 'user';

create table if not exists public.studio_agent_proposals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.studio_agent_conversations(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  kind text not null check (kind in ('episode_edit')),
  status text not null default 'pending'
    check (status in ('pending', 'applying', 'applied', 'rejected', 'stale', 'failed')),
  title text not null check (char_length(title) <= 200),
  rationale text not null default '' check (char_length(rationale) <= 4000),
  -- {base_revision_id, base_hash, edits: [{block_index, old_text, new_text, reason, ...}]}
  payload jsonb not null,
  applied_revision_id uuid references public.episode_revisions(id) on delete set null,
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists studio_agent_proposals_creator_status_idx
  on public.studio_agent_proposals(creator_id, status, created_at desc);
create index if not exists studio_agent_proposals_conversation_idx
  on public.studio_agent_proposals(conversation_id, created_at);

alter table public.studio_agent_conversations enable row level security;
alter table public.studio_agent_messages enable row level security;
alter table public.studio_agent_proposals enable row level security;

revoke all on public.studio_agent_conversations from public, anon, authenticated;
revoke all on public.studio_agent_messages from public, anon, authenticated;
revoke all on public.studio_agent_proposals from public, anon, authenticated;
grant all on public.studio_agent_conversations to service_role;
grant all on public.studio_agent_messages to service_role;
grant all on public.studio_agent_proposals to service_role;
