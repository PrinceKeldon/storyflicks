-- Studio assistant: two more kinds of author-approved proposals.
--   review_reply      - a drafted public reply to a reader review
--   chapter_renumber  - new chapter numbers (reordering) for one story
-- Neither is applied until the author approves it in the Studio.

alter table public.studio_agent_proposals alter column episode_id drop not null;

alter table public.studio_agent_proposals drop constraint if exists studio_agent_proposals_kind_check;
alter table public.studio_agent_proposals
  add constraint studio_agent_proposals_kind_check
  check (kind in ('episode_edit', 'review_reply', 'chapter_renumber'));

-- Renumber several chapters of one story atomically. The expected old numbers
-- are checked again inside this transaction after locking every existing row
-- for the story. This closes the API-check/RPC-update race and serialises
-- concurrent edits to existing episode rows. Swaps work by moving affected
-- rows to unique temporary numbers before applying their final numbers.
-- Backend only (service role): the API checks the creator's permission first.
create or replace function public.apply_agent_chapter_renumber(p_story_id uuid, p_moves jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_updated integer;
  v_max_number bigint;
begin
  if p_moves is null or jsonb_typeof(p_moves) <> 'array'
     or jsonb_array_length(p_moves) = 0 or jsonb_array_length(p_moves) > 200 then
    raise exception 'moves must be a non-empty list of at most 200 chapters';
  end if;

  create temporary table pg_temp.agent_chapter_moves on commit drop as
    select
      (m->>'episode_id')::uuid as episode_id,
      (m->>'from_sequence_number')::integer as old_number,
      (m->>'sequence_number')::integer as new_number
    from jsonb_array_elements(p_moves) m;

  select count(*) into v_count from pg_temp.agent_chapter_moves;
  if (select count(distinct episode_id) from pg_temp.agent_chapter_moves) <> v_count
     or (select count(distinct new_number) from pg_temp.agent_chapter_moves) <> v_count
     or exists (
       select 1 from pg_temp.agent_chapter_moves
       where old_number is null or old_number < 1
          or new_number is null or new_number < 1 or new_number > 100000
     ) then
    raise exception 'moves must name each chapter once, with valid old and new numbers';
  end if;

  -- Lock all existing rows in a stable order, not just the rows being moved.
  -- This makes the current number and target-collision checks authoritative.
  perform 1
    from public.episodes e
    where e.story_id = p_story_id
    order by e.id
    for update;

  -- A changed, missing, deleted, or foreign chapter makes the proposal stale.
  if (
    select count(*)
    from pg_temp.agent_chapter_moves m
    join public.episodes e
      on e.id = m.episode_id
     and e.story_id = p_story_id
     and e.deleted_at is null
     and e.sequence_number = m.old_number
  ) <> v_count then
    return -1;
  end if;

  -- A new/changed chapter may now occupy one of the proposed target numbers.
  -- Include soft-deleted rows because the story's unique number constraint
  -- also reserves their numbers.
  if exists (
    select 1
    from public.episodes e
    join pg_temp.agent_chapter_moves m on e.sequence_number = m.new_number
    where e.story_id = p_story_id
      and e.id not in (select episode_id from pg_temp.agent_chapter_moves)
  ) then
    return -1;
  end if;

  select coalesce(max(e.sequence_number), 0)::bigint
    into v_max_number
    from public.episodes e
    where e.story_id = p_story_id;

  if v_max_number + v_count > 2147483647 then
    raise exception 'chapter numbers are too large to renumber safely';
  end if;

  -- Move affected rows above every currently assigned number, using distinct
  -- temporary values, so immediate unique constraints permit swaps.
  update public.episodes e
     set sequence_number = (v_max_number + ranked.temp_number)::integer
    from (
      select episode_id, row_number() over (order by episode_id) as temp_number
      from pg_temp.agent_chapter_moves
    ) ranked
   where e.id = ranked.episode_id
     and e.story_id = p_story_id;

  update public.episodes e
     set sequence_number = m.new_number
    from pg_temp.agent_chapter_moves m
   where e.id = m.episode_id
     and e.story_id = p_story_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.apply_agent_chapter_renumber(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_agent_chapter_renumber(uuid, jsonb) to service_role;
