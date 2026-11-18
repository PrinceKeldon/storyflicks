-- Episode/chapter guide synopses are independent metadata, saved directly on
-- public.episodes. Publishing a manuscript revision must never replace or clear
-- that metadata from the revision's synopsis field (which may be NULL/stale).

create or replace function public.publish_creator_episode(
    p_episode_id uuid,
    p_revision_id uuid,
    p_action text,
    p_scheduled_at timestamp with time zone default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_story_id uuid;
    v_role text;
    v_revision public.episode_revisions%rowtype;
    v_episode public.episodes%rowtype;
    v_queue_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1
        from public.creator_profiles cp
        where cp.id = v_user_id
          and cp.status = 'active'
    ) then
        raise exception 'An active creator profile is required';
    end if;

    if p_action not in ('publish', 'schedule', 'cancel_schedule') then
        raise exception 'Invalid publication action';
    end if;

    select e.*
    into v_episode
    from public.episodes e
    where e.id = p_episode_id
    for update;

    if not found then
        raise exception 'Episode not found';
    end if;

    v_story_id := v_episode.story_id;

    select sc.role
    into v_role
    from public.story_creators sc
    where sc.story_id = v_story_id
      and sc.creator_id = v_user_id
      and sc.role in ('owner', 'author', 'editor');

    if v_role is null then
        raise exception 'You do not have permission to publish this episode';
    end if;

    if p_action = 'cancel_schedule' then
        update public.episode_publication_queue
        set status = 'cancelled'
        where episode_id = p_episode_id
          and status = 'scheduled';

        if v_episode.publication_status = 'scheduled' then
            update public.episodes
            set publication_status = 'draft',
                scheduled_at = null
            where id = p_episode_id;
        else
            update public.episodes
            set scheduled_at = null
            where id = p_episode_id;
        end if;

        return jsonb_build_object(
            'episode_id', p_episode_id,
            'action', 'cancel_schedule',
            'status', 'cancelled'
        );
    end if;

    select er.*
    into v_revision
    from public.episode_revisions er
    where er.id = p_revision_id
      and er.episode_id = p_episode_id
    for update;

    if not found then
        raise exception 'Revision not found for this episode';
    end if;

    if v_revision.revision_status <> 'draft' then
        raise exception 'Only draft revisions can be published';
    end if;

    if p_action = 'schedule' then
        if p_scheduled_at is null or p_scheduled_at <= now() then
            raise exception 'A future publication time is required';
        end if;

        update public.episode_publication_queue
        set status = 'cancelled'
        where episode_id = p_episode_id
          and status = 'scheduled';

        insert into public.episode_publication_queue (
            episode_id, revision_id, scheduled_at, created_by
        )
        values (
            p_episode_id, p_revision_id, p_scheduled_at, v_user_id
        )
        returning id into v_queue_id;

        if v_episode.publication_status <> 'published' then
            update public.episodes
            set publication_status = 'scheduled',
                scheduled_at = p_scheduled_at
            where id = p_episode_id;
        else
            update public.episodes
            set scheduled_at = p_scheduled_at
            where id = p_episode_id;
        end if;

        insert into public.publication_history (
            story_id, episode_id, actor_id, event_type, details
        )
        values (
            v_story_id, p_episode_id, v_user_id, 'episode_scheduled',
            jsonb_build_object(
                'revision_id', p_revision_id,
                'queue_id', v_queue_id,
                'scheduled_at', p_scheduled_at
            )
        );

        return jsonb_build_object(
            'episode_id', p_episode_id,
            'revision_id', p_revision_id,
            'queue_id', v_queue_id,
            'action', 'schedule',
            'scheduled_at', p_scheduled_at,
            'status', 'scheduled'
        );
    end if;

    update public.episode_publication_queue
    set status = 'cancelled'
    where episode_id = p_episode_id
      and status = 'scheduled';

    -- Keep episodes.synopsis untouched: it is the canonical, independently
    -- saved guide synopsis, not a field owned by a manuscript revision.
    update public.episodes
    set title = v_revision.title,
        content = v_revision.content,
        publication_status = 'published',
        published_at = now(),
        scheduled_at = null
    where id = p_episode_id;

    update public.episode_revisions
    set revision_status = 'published',
        published_at = now()
    where id = p_revision_id;

    insert into public.publication_history (
        story_id, episode_id, actor_id, event_type, details
    )
    values (
        v_story_id, p_episode_id, v_user_id, 'episode_published',
        jsonb_build_object(
            'revision_id', p_revision_id,
            'revision_number', v_revision.revision_number
        )
    );

    return jsonb_build_object(
        'episode_id', p_episode_id,
        'revision_id', p_revision_id,
        'action', 'publish',
        'status', 'published'
    );
end;
$$;


create or replace function public.publish_due_episodes(
    p_limit integer default 100
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_item record;
    v_count integer := 0;
begin
    if p_limit < 1 or p_limit > 500 then
        raise exception 'Limit must be between 1 and 500';
    end if;

    for v_item in
        select
            q.id as queue_id,
            q.episode_id,
            q.revision_id,
            e.story_id,
            er.revision_number,
            er.title,
            er.content
        from public.episode_publication_queue q
        join public.episodes e on e.id = q.episode_id
        join public.episode_revisions er on er.id = q.revision_id
        where q.status = 'scheduled'
          and q.scheduled_at <= now()
          and er.revision_status = 'draft'
        order by q.scheduled_at, q.id
        limit p_limit
        for update of q skip locked
    loop
        -- As with immediate publication, scheduled publication must preserve
        -- the independently saved synopsis already stored on the episode.
        update public.episodes
        set title = v_item.title,
            content = v_item.content,
            publication_status = 'published',
            published_at = now(),
            scheduled_at = null
        where id = v_item.episode_id;

        update public.episode_revisions
        set revision_status = 'published',
            published_at = now()
        where id = v_item.revision_id;

        update public.episode_publication_queue
        set status = 'published',
            published_at = now()
        where id = v_item.queue_id;

        insert into public.publication_history (
            story_id, episode_id, actor_id, event_type, details
        )
        values (
            v_item.story_id, v_item.episode_id, null, 'episode_published',
            jsonb_build_object(
                'revision_id', v_item.revision_id,
                'revision_number', v_item.revision_number,
                'automatic', true
            )
        );

        v_count := v_count + 1;
    end loop;

    return jsonb_build_object('published_count', v_count);
end;
$$;
