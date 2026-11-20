-- Chapter review status and ordering
--
-- "Ready for review" sits between Draft and Published. It is a flag on a draft chapter, not a new
-- publication status, so reader visibility, counts and the publish flow are unchanged. The flag clears
-- automatically whenever the chapter's content or title changes, or it stops being a draft.

alter table public.episodes
  add column if not exists ready_for_review boolean not null default false;

create or replace function public.clear_episode_ready_for_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ready_for_review and (
       new.publication_status is distinct from 'draft'
       or new.content is distinct from old.content
       or new.title is distinct from old.title
     ) then
    new.ready_for_review := false;
  end if;
  return new;
end;
$$;

drop trigger if exists episodes_clear_ready_for_review on public.episodes;
create trigger episodes_clear_ready_for_review
  before update on public.episodes
  for each row execute function public.clear_episode_ready_for_review();

-- Reorder every active chapter of a story in one transaction. Called only by the API (service role)
-- after it has checked that the caller edits the story. Chapters are renumbered 1..n in the given order.
create or replace function public.reorder_creator_episodes(p_story_id uuid, p_episode_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_given integer;
  v_matching integer;
begin
  v_given := coalesce(array_length(p_episode_ids, 1), 0);
  select count(*) into v_total from public.episodes
    where story_id = p_story_id and deleted_at is null;
  select count(*) into v_matching from public.episodes
    where story_id = p_story_id and deleted_at is null and id = any(p_episode_ids);

  if v_given = 0
     or v_given <> v_total
     or v_matching <> v_given
     or (select count(distinct x) from unnest(p_episode_ids) as x) <> v_given then
    raise exception 'The new order must list every chapter of the story exactly once';
  end if;

  -- Two steps so the unique (story_id, sequence_number) index never sees a clash mid-update.
  update public.episodes
    set sequence_number = sequence_number + 1000000
    where story_id = p_story_id and deleted_at is null;

  update public.episodes e
    set sequence_number = o.position::integer, updated_at = now()
    from unnest(p_episode_ids) with ordinality as o(id, position)
    where e.id = o.id and e.story_id = p_story_id and e.deleted_at is null;

  return v_given;
end;
$$;

revoke all on function public.reorder_creator_episodes(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_creator_episodes(uuid, uuid[]) to service_role;
