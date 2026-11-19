-- STORYFLICKS editorial curation and per-title identity metadata.
alter table public.stories
  add column if not exists origin_type text not null default 'independent',
  add column if not exists content_format text not null default 'standalone';

alter table public.stories
  add constraint stories_origin_type_check
    check (origin_type in ('storyflicks_original', 'previously_published', 'independent')),
  add constraint stories_content_format_check
    check (content_format in ('standalone', 'series'));

-- Correct the two currently published titles using explicit editorial facts.
update public.stories
set origin_type = 'storyflicks_original', content_format = 'series'
where slug = 'the-priest';

update public.stories
set origin_type = 'previously_published', content_format = 'standalone'
where slug = 'crossing-ubuntu';

create table if not exists public.discovery_settings (
  id boolean primary key default true check (id = true),
  featured_story_id uuid null references public.stories(id) on delete set null,
  featured_kicker text not null default 'FEATURED STORY',
  updated_at timestamptz not null default now()
);

insert into public.discovery_settings (id)
values (true)
on conflict (id) do nothing;

-- Editorial curation is a platform-level capability, not a story-editor permission.
create table if not exists public.discovery_curators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The project currently has one active creator account. Grant that account the
-- initial editorial-curator role; future creator accounts do not inherit it.
insert into public.discovery_curators (user_id)
select id from public.creator_profiles
where status = 'active'
on conflict (user_id) do nothing;

alter table public.discovery_settings enable row level security;
alter table public.discovery_curators enable row level security;
revoke all on public.discovery_settings from anon, authenticated;
revoke all on public.discovery_curators from anon, authenticated;
