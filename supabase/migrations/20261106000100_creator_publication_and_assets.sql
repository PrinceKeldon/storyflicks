-- STORYFLICKS backend completion: story publication, scheduled-edit safety, and creator assets.
-- Apply once in the Supabase SQL Editor. This migration is safe to re-run.

create or replace function public.publish_creator_story(p_story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_story public.stories%rowtype;
    v_published_episode_count integer;
begin
    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;

    if not exists (
        select 1
        from public.creator_profiles cp
        where cp.id = v_user_id
          and cp.status = 'active'
    ) then
        raise exception 'An active creator profile is required.';
    end if;

    select s.*
      into v_story
      from public.stories s
     where s.id = p_story_id
     for update;

    if not found then
        raise exception 'Story not found.';
    end if;

    if not exists (
        select 1
        from public.story_creators sc
        where sc.story_id = p_story_id
          and sc.creator_id = v_user_id
          and sc.role in ('owner', 'author', 'editor')
    ) then
        raise exception 'You do not have permission to publish this story.';
    end if;

    select count(*)
      into v_published_episode_count
      from public.episodes e
     where e.story_id = p_story_id
       and e.publication_status = 'published';

    if v_published_episode_count = 0 then
        raise exception 'Publish at least one episode before publishing a story.';
    end if;

    if v_story.publication_status = 'archived' then
        raise exception 'An archived story cannot be published.';
    end if;

    if v_story.publication_status = 'published' then
        return jsonb_build_object(
            'story_id', p_story_id,
            'publication_status', 'published',
            'already_published', true,
            'published_episode_count', v_published_episode_count
        );
    end if;

    update public.stories
       set publication_status = 'published',
           published_at = coalesce(published_at, now()),
           updated_at = now()
     where id = p_story_id;

    insert into public.publication_history (
        story_id,
        actor_id,
        event_type,
        details
    )
    values (
        p_story_id,
        v_user_id,
        'story_published',
        jsonb_build_object(
            'published_episode_count', v_published_episode_count
        )
    );

    return jsonb_build_object(
        'story_id', p_story_id,
        'publication_status', 'published',
        'already_published', false,
        'published_episode_count', v_published_episode_count
    );
end;
$$;

revoke all on function public.publish_creator_story(uuid) from public, anon, authenticated;
grant execute on function public.publish_creator_story(uuid) to authenticated;


-- Saving a new revision to a scheduled episode cancels the old schedule.
-- This prevents a stale queued revision from publishing after the creator
-- has changed the episode content.
create or replace function public.cancel_episode_schedule_on_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_story_id uuid;
    v_status text;
    v_queue_cancelled integer;
begin
    select e.story_id, e.publication_status
      into v_story_id, v_status
      from public.episodes e
     where e.id = new.episode_id
     for update;

    if v_status = 'scheduled' then
        update public.episode_publication_queue
           set status = 'cancelled'
         where episode_id = new.episode_id
           and status = 'scheduled';

        get diagnostics v_queue_cancelled = row_count;

        update public.episodes
           set publication_status = 'draft',
               scheduled_at = null,
               updated_at = now()
         where id = new.episode_id;

        insert into public.publication_history (
            story_id,
            episode_id,
            actor_id,
            event_type,
            details
        )
        values (
            v_story_id,
            new.episode_id,
            new.created_by,
            'episode_schedule_cancelled_by_revision',
            jsonb_build_object(
                'new_revision_id', new.id,
                'cancelled_queue_rows', v_queue_cancelled
            )
        );
    end if;

    return new;
end;
$$;

revoke all on function public.cancel_episode_schedule_on_revision() from public, anon, authenticated;

drop trigger if exists episode_revision_cancels_stale_schedule
    on public.episode_revisions;

create trigger episode_revision_cancels_stale_schedule
after insert on public.episode_revisions
for each row
execute function public.cancel_episode_schedule_on_revision();


-- Creator-uploaded story artwork and episode images are publicly readable,
-- but uploads are issued only by the authenticated backend.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'story-assets',
    'story-assets',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


create or replace function public.set_creator_story_cover(
    p_story_id uuid,
    p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;

    if not exists (
        select 1 from public.creator_profiles cp
        where cp.id = v_user_id and cp.status = 'active'
    ) then
        raise exception 'An active creator profile is required.';
    end if;

    if not exists (
        select 1 from public.story_creators sc
        where sc.story_id = p_story_id
          and sc.creator_id = v_user_id
          and sc.role in ('owner', 'author', 'editor')
    ) then
        raise exception 'You do not have permission to edit this story.';
    end if;

    if p_storage_path is null
       or p_storage_path not like v_user_id::text || '/' || p_story_id::text || '/cover/%' then
        raise exception 'Invalid story cover storage path.';
    end if;

    update public.stories
       set cover_path = p_storage_path,
           updated_at = now()
     where id = p_story_id;

    if not found then
        raise exception 'Story not found.';
    end if;

    return jsonb_build_object(
        'story_id', p_story_id,
        'cover_path', p_storage_path
    );
end;
$$;

revoke all on function public.set_creator_story_cover(uuid, text) from public, anon, authenticated;
grant execute on function public.set_creator_story_cover(uuid, text) to authenticated;


create or replace function public.register_creator_episode_image(
    p_episode_id uuid,
    p_storage_path text,
    p_alt_text text default null,
    p_position integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_story_id uuid;
    v_asset_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;

    if not exists (
        select 1 from public.creator_profiles cp
        where cp.id = v_user_id and cp.status = 'active'
    ) then
        raise exception 'An active creator profile is required.';
    end if;

    select e.story_id
      into v_story_id
      from public.episodes e
     where e.id = p_episode_id;

    if v_story_id is null then
        raise exception 'Episode not found.';
    end if;

    if not exists (
        select 1 from public.story_creators sc
        where sc.story_id = v_story_id
          and sc.creator_id = v_user_id
          and sc.role in ('owner', 'author', 'editor')
    ) then
        raise exception 'You do not have permission to edit this episode.';
    end if;

    if p_storage_path is null
       or p_storage_path not like v_user_id::text || '/' || v_story_id::text || '/episodes/' || p_episode_id::text || '/%' then
        raise exception 'Invalid episode image storage path.';
    end if;

    insert into public.episode_assets (
        episode_id,
        asset_type,
        storage_path,
        alt_text,
        position,
        metadata
    )
    values (
        p_episode_id,
        'inline_image',
        p_storage_path,
        nullif(trim(p_alt_text), ''),
        greatest(coalesce(p_position, 0), 0),
        jsonb_build_object('uploaded_by', v_user_id)
    )
    returning id into v_asset_id;

    return jsonb_build_object(
        'asset_id', v_asset_id,
        'episode_id', p_episode_id,
        'asset_type', 'inline_image',
        'storage_path', p_storage_path
    );
end;
$$;

revoke all on function public.register_creator_episode_image(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.register_creator_episode_image(uuid, text, text, integer) to authenticated;
