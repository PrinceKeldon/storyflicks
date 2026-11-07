ALTER TABLE public.stories
ADD COLUMN IF NOT EXISTS genres text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.stories
SET genres = ARRAY['Drama']::text[]
WHERE slug = 'the-priest'
  AND coalesce(cardinality(genres), 0) = 0;

CREATE OR REPLACE FUNCTION public.save_creator_story_v2(
    p_story_id uuid,
    p_title text,
    p_slug text,
    p_tagline text,
    p_synopsis text,
    p_first_episode_free boolean,
    p_genres text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_story_id uuid;
    v_role text;
    v_genres text[];
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.creator_profiles cp
        WHERE cp.id = v_user_id
          AND cp.status = 'active'
    ) THEN
        RAISE EXCEPTION 'An active creator profile is required';
    END IF;

    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
        RAISE EXCEPTION 'Story title is required';
    END IF;

    IF p_slug IS NULL
       OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
        RAISE EXCEPTION 'Invalid story slug';
    END IF;

    IF p_first_episode_free IS NULL THEN
        RAISE EXCEPTION 'First episode access setting is required';
    END IF;

    IF coalesce(cardinality(p_genres), 0) > 5 THEN
        RAISE EXCEPTION 'A story can have at most five genres';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(coalesce(p_genres, '{}'::text[])) AS g(value)
        WHERE length(trim(g.value)) > 40
           OR (trim(g.value) <> '' AND trim(g.value) !~ '^[[:alnum:]][[:alnum:] &-]*$')
    ) THEN
        RAISE EXCEPTION 'Genres may contain letters, numbers, spaces, ampersands and hyphens only';
    END IF;

    SELECT coalesce(
        array_agg(normalized.genre ORDER BY normalized.genre),
        '{}'::text[]
    )
    INTO v_genres
    FROM (
        SELECT DISTINCT initcap(trim(g.value)) AS genre
        FROM unnest(coalesce(p_genres, '{}'::text[])) AS g(value)
        WHERE trim(g.value) <> ''
    ) AS normalized;

    IF p_story_id IS NULL THEN
        INSERT INTO public.stories (
            slug,
            title,
            tagline,
            synopsis,
            genres,
            publication_status,
            first_episode_free,
            created_by
        )
        VALUES (
            p_slug,
            trim(p_title),
            nullif(trim(p_tagline), ''),
            nullif(trim(p_synopsis), ''),
            v_genres,
            'draft',
            p_first_episode_free,
            v_user_id
        )
        RETURNING id INTO v_story_id;

        INSERT INTO public.story_creators (
            story_id,
            creator_id,
            role
        )
        VALUES (
            v_story_id,
            v_user_id,
            'owner'
        );

        INSERT INTO public.publication_history (
            story_id,
            actor_id,
            event_type,
            details
        )
        VALUES (
            v_story_id,
            v_user_id,
            'story_created',
            jsonb_build_object('title', trim(p_title), 'genres', v_genres)
        );
    ELSE
        SELECT sc.role
        INTO v_role
        FROM public.story_creators sc
        WHERE sc.story_id = p_story_id
          AND sc.creator_id = v_user_id
          AND sc.role IN ('owner', 'author', 'editor');

        IF v_role IS NULL THEN
            RAISE EXCEPTION 'You do not have permission to edit this story';
        END IF;

        UPDATE public.stories
        SET
            title = trim(p_title),
            slug = p_slug,
            tagline = nullif(trim(p_tagline), ''),
            synopsis = nullif(trim(p_synopsis), ''),
            genres = v_genres,
            first_episode_free = p_first_episode_free
        WHERE id = p_story_id
        RETURNING id INTO v_story_id;

        IF v_story_id IS NULL THEN
            RAISE EXCEPTION 'Story not found';
        END IF;

        INSERT INTO public.publication_history (
            story_id,
            actor_id,
            event_type,
            details
        )
        VALUES (
            v_story_id,
            v_user_id,
            'story_updated',
            jsonb_build_object('title', trim(p_title), 'genres', v_genres)
        );
    END IF;

    RETURN jsonb_build_object(
        'story_id', v_story_id,
        'title', trim(p_title),
        'slug', p_slug,
        'genres', v_genres
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_creator_story_v2(uuid, text, text, text, text, boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_creator_story_v2(uuid, text, text, text, text, boolean, text[]) TO authenticated;
