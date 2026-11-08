-- Align reader RPCs with the existing live schema and table-returning access assertion.

CREATE OR REPLACE FUNCTION public.save_reading_progress(
    p_episode_id uuid,
    p_progress_percent numeric,
    p_last_position jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_progress public.reading_progress%rowtype;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_progress_percent IS NULL
       OR p_progress_percent < 0
       OR p_progress_percent > 100 THEN
        RAISE EXCEPTION 'Progress must be between 0 and 100';
    END IF;

    PERFORM public.assert_episode_access(v_user_id, p_episode_id);

    INSERT INTO public.reading_progress (
        user_id, episode_id, progress_percent, last_position,
        started_at, completed_at, updated_at
    )
    VALUES (
        v_user_id, p_episode_id, p_progress_percent, p_last_position,
        now(),
        CASE WHEN p_progress_percent = 100 THEN now() ELSE NULL END,
        now()
    )
    ON CONFLICT (user_id, episode_id)
    DO UPDATE SET
        progress_percent = EXCLUDED.progress_percent,
        last_position = coalesce(
            EXCLUDED.last_position,
            public.reading_progress.last_position
        ),
        completed_at = coalesce(
            public.reading_progress.completed_at,
            EXCLUDED.completed_at
        ),
        updated_at = now()
    RETURNING * INTO v_progress;

    RETURN jsonb_build_object(
        'episode_id', v_progress.episode_id,
        'progress_percent', v_progress.progress_percent,
        'last_position', v_progress.last_position,
        'started_at', v_progress.started_at,
        'completed_at', v_progress.completed_at,
        'updated_at', v_progress.updated_at
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_reader_preferences(
    p_theme text,
    p_text_size text,
    p_reading_width text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_preferences public.reader_preferences%rowtype;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_theme NOT IN ('paper', 'sepia', 'night') THEN
        RAISE EXCEPTION 'Invalid reading theme';
    END IF;

    IF p_text_size NOT IN ('small', 'comfortable', 'large') THEN
        RAISE EXCEPTION 'Invalid text size';
    END IF;

    IF p_reading_width NOT IN ('narrow', 'standard', 'wide') THEN
        RAISE EXCEPTION 'Invalid reading width';
    END IF;

    INSERT INTO public.reader_preferences (
        user_id, reading_theme, text_size, reading_width
    )
    VALUES (
        v_user_id, p_theme, p_text_size, p_reading_width
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
        reading_theme = EXCLUDED.reading_theme,
        text_size = EXCLUDED.text_size,
        reading_width = EXCLUDED.reading_width,
        updated_at = now()
    RETURNING * INTO v_preferences;

    RETURN jsonb_build_object(
        'theme', v_preferences.reading_theme,
        'text_size', v_preferences.text_size,
        'reading_width', v_preferences.reading_width,
        'updated_at', v_preferences.updated_at
    );
END;
$function$;
