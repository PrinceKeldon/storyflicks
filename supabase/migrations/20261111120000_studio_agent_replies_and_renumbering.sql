-- Studio assistant: two more kinds of author-approved proposals.
--   review_reply      - a drafted public reply to a reader review
--   chapter_renumber  - new chapter numbers (reordering) for one story
-- Neither is applied until the author approves it in the Studio.

alter table public.studio_agent_proposals alter column episode_id drop not null;

alter table public.studio_agent_proposals drop constraint if exists studio_agent_proposals_kind_check;
alter table public.studio_agent_proposals
  add constraint studio_agent_proposals_kind_check
  check (kind in ('episode_edit', 'review_reply', 'chapter_renumber'));

-- Renumber several chapters of one story atomically. The unique
-- (story_id, sequence_number) constraint is checked row by row, so a swap
-- (1<->2) would collide. Moving the affected rows out of the way first, in the
-- same transaction, makes swaps and shifts work; any failure rolls it all back.
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
begin
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) = 0 or jsonb_array_length(p_moves) > 200 then
    raise exception 'moves must be a non-empty list of at most 200 chapters';
  end if;

  create temporary table agent_moves on commit drop as
    select (m->>'episode_id')::uuid as episode_id, (m->>'sequence_number')::integer as new_number
    from jsonb_array_elements(p_moves) m;

  select count(*) into v_count from agent_moves;
  if (select count(distinct episode_id) from agent_moves) <> v_count
     or (select count(distinct new_number) from agent_moves) <> v_count
     or exists (select 1 from agent_moves where new_number is null or new_number < 1 or new_number > 100000) then
    raise exception 'moves must name each chapter once, with distinct numbers from 1 to 100000';
  end if;

  perform 1 from public.episodes e
    where e.story_id = p_story_id and e.id in (select episode_id from agent_moves)
    for update;

  if (select count(*) from public.episodes e
      where e.story_id = p_story_id and e.deleted_at is null
        and e.id in (select episode_id from agent_moves)) <> v_count then
    raise exception 'every chapter must belong to the story and not be in the trash';
  end if;

  update public.episodes e set sequence_number = e.sequence_number + 1000000
    where e.story_id = p_story_id and e.id in (select episode_id from agent_moves);
  update public.episodes e set sequence_number = m.new_number
    from agent_moves m where e.id = m.episode_id and e.story_id = p_story_id;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.apply_agent_chapter_renumber(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_agent_chapter_renumber(uuid, jsonb) to service_role;
