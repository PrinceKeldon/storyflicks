CREATE OR REPLACE FUNCTION public.get_creator_story_workspace(p_story_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_story jsonb;
    v_role text;
    v_seasons jsonb;
    v_episodes jsonb;
    v_total_episodes integer;
    v_published_episodes integer;
    v_draft_episodes integer;
    v_scheduled_episodes integer;
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

    select sc.role
    into v_role
    from public.story_creators sc
    where sc.story_id = p_story_id
      and sc.creator_id = v_user_id;

    if v_role is null or v_role not in ('owner', 'author', 'editor') then
        raise exception 'You do not have permission to manage this story';
    end if;

    select to_jsonb(s)
    into v_story
    from public.stories s
    where s.id = p_story_id;

    if v_story is null then
        raise exception 'Story not found';
    end if;

    select coalesce(
        jsonb_agg(to_jsonb(s) order by s.id),
        '[]'::jsonb
    )
    into v_seasons
    from public.seasons s
    where s.story_id = p_story_id;

    select
        coalesce(
            jsonb_agg(
                to_jsonb(e) ||
                jsonb_build_object(
                    'latest_revision',
                    (
                        select jsonb_build_object(
                            'id', er.id,
                            'revision_number', er.revision_number,
                            'revision_status', er.revision_status,
                            'created_at', er.created_at,
                            'published_at', er.published_at
                        )
                        from public.episode_revisions er
                        where er.episode_id = e.id
                        order by er.revision_number desc
                        limit 1
                    )
                )
                order by e.sequence_number
            ),
            '[]'::jsonb
        ),
        count(*)::integer,
        count(*) filter (
            where e.publication_status = 'published'
        )::integer,
        count(*) filter (
            where e.publication_status = 'draft'
        )::integer,
        count(*) filter (
            where e.publication_status = 'scheduled'
        )::integer
    into
        v_episodes,
        v_total_episodes,
        v_published_episodes,
        v_draft_episodes,
        v_scheduled_episodes
    from public.episodes e
    where e.story_id = p_story_id;

    return jsonb_build_object(
        'story', v_story,
        'creator_role', v_role,
        'seasons', v_seasons,
        'episodes', v_episodes,
        'episode_summary', jsonb_build_object(
            'total', v_total_episodes,
            'published', v_published_episodes,
            'draft', v_draft_episodes,
            'scheduled', v_scheduled_episodes
        )
    );
end;
$function$;
