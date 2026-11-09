-- Keep the section catalogue and reader-facing title aligned with the latest saved draft.
-- Published manuscript content remains untouched until the selected revision is published.

create or replace function public.save_creator_episode(
    p_episode_id uuid,
    p_story_id uuid,
    p_season_id uuid,
    p_sequence_number integer,
    p_title text,
    p_synopsis text,
    p_content jsonb
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_episode_id uuid;
    v_revision_number integer;
    v_publication_status text;
    v_role text;
    v_is_new boolean := false;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1 from public.creator_profiles cp
        where cp.id = v_user_id and cp.status = 'active'
    ) then
        raise exception 'An active creator profile is required';
    end if;

    select sc.role into v_role
    from public.story_creators sc
    where sc.story_id = p_story_id
      and sc.creator_id = v_user_id
      and sc.role in ('owner', 'author', 'editor');

    if v_role is null then
        raise exception 'You do not have permission to edit this story';
    end if;

    if p_sequence_number is null or p_sequence_number < 1 then
        raise exception 'A valid episode sequence number is required';
    end if;

    if p_title is null or length(trim(p_title)) = 0 then
        raise exception 'Episode title is required';
    end if;

    if p_content is null or jsonb_typeof(p_content) <> 'object' then
        raise exception 'Episode content must be a JSON object';
    end if;

    if p_season_id is not null and not exists (
        select 1 from public.seasons s
        where s.id = p_season_id and s.story_id = p_story_id
    ) then
        raise exception 'Season does not belong to this story';
    end if;

    if p_episode_id is null then
        insert into public.episodes (
            story_id, season_id, sequence_number, title, synopsis, content, publication_status
        ) values (
            p_story_id, p_season_id, p_sequence_number, trim(p_title),
            nullif(trim(p_synopsis), ''), p_content, 'draft'
        )
        returning id into v_episode_id;

        v_is_new := true;
        v_publication_status := 'draft';
    else
        select e.publication_status
        into v_publication_status
        from public.episodes e
        where e.id = p_episode_id and e.story_id = p_story_id
        for update;

        if not found then
            raise exception 'Episode not found in this story';
        end if;

        v_episode_id := p_episode_id;

        if v_publication_status in ('published', 'scheduled') then
            -- The title is shared metadata: sync it immediately, but do not
            -- expose draft synopsis or manuscript content before publication.
            update public.episodes
            set title = trim(p_title), updated_at = now()
            where id = v_episode_id;
        else
            update public.episodes
            set
                season_id = p_season_id,
                sequence_number = p_sequence_number,
                title = trim(p_title),
                synopsis = nullif(trim(p_synopsis), ''),
                content = p_content,
                publication_status = 'draft',
                scheduled_at = null,
                updated_at = now()
            where id = v_episode_id;

            v_publication_status := 'draft';
        end if;
    end if;

    select coalesce(max(er.revision_number), 0) + 1
    into v_revision_number
    from public.episode_revisions er
    where er.episode_id = v_episode_id;

    insert into public.episode_revisions (
        episode_id, revision_number, title, synopsis, content,
        revision_status, created_by
    ) values (
        v_episode_id, v_revision_number, trim(p_title),
        nullif(trim(p_synopsis), ''), p_content, 'draft', v_user_id
    );

    insert into public.publication_history (
        story_id, episode_id, actor_id, event_type, details
    ) values (
        p_story_id, v_episode_id, v_user_id, 'episode_draft_saved',
        jsonb_build_object('revision_number', v_revision_number, 'title', trim(p_title))
    );

    return jsonb_build_object(
        'episode_id', v_episode_id,
        'story_id', p_story_id,
        'revision_number', v_revision_number,
        'revision_status', 'draft',
        'episode_publication_status', v_publication_status,
        'new_episode', v_is_new
    );
end;
$$;
