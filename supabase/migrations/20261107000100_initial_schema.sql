


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."assert_episode_access"("p_user_id" "uuid", "p_episode_id" "uuid") RETURNS TABLE("story_id" "uuid", "sequence_number" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
    return query
    select e.story_id, e.sequence_number
    from public.episodes e
    join public.stories s on s.id = e.story_id
    where e.id = p_episode_id
      and e.publication_status = 'published'
      and s.publication_status = 'published'
      and (
          exists (
              select 1
              from public.episode_entitlements ee
              where ee.user_id = p_user_id
                and ee.episode_id = e.id
          )
          or (
              e.sequence_number = 1
              and s.first_episode_free = true
          )
      );

    if not found then
        raise exception 'Episode is not accessible for contribution.'
            using errcode = '42501';
    end if;
end;
$$;


ALTER FUNCTION "public"."assert_episode_access"("p_user_id" "uuid", "p_episode_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bookmark_story"("p_story_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1
        from public.stories
        where id = p_story_id
          and publication_status = 'published'
    ) then
        raise exception 'Published story not found';
    end if;

    insert into public.bookmarks (user_id, story_id)
    values (v_user_id, p_story_id)
    on conflict (user_id, story_id) do nothing;

    return jsonb_build_object(
        'story_id', p_story_id,
        'saved', true
    );
end;
$$;


ALTER FUNCTION "public"."bookmark_story"("p_story_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_episode_schedule_on_revision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."cancel_episode_schedule_on_revision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_creator_author_notes"("p_story_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'all'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_result jsonb;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1
        from public.creator_profiles
        where id = v_user_id
          and status = 'active'
    ) then
        raise exception 'Active creator account required';
    end if;

    if p_status not in ('all', 'draft', 'scheduled', 'published', 'withdrawn') then
        raise exception 'Invalid note status';
    end if;

    if p_story_id is not null and not exists (
        select 1
        from public.story_creators
        where story_id = p_story_id
          and creator_id = v_user_id
          and role in ('owner', 'author', 'editor')
    ) then
        raise exception 'You cannot access notes for this story';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', n.id,
                'story_id', n.story_id,
                'story_title', s.title,
                'episode_id', n.episode_id,
                'episode_title', e.title,
                'creator_id', n.creator_id,
                'title', n.title,
                'body', n.body,
                'status', n.status,
                'is_pinned', n.is_pinned,
                'scheduled_at', n.scheduled_at,
                'published_at', n.published_at,
                'created_at', n.created_at,
                'updated_at', n.updated_at
            )
            order by n.updated_at desc
        ),
        '[]'::jsonb
    )
    into v_result
    from public.author_notes n
    join public.stories s on s.id = n.story_id
    left join public.episodes e on e.id = n.episode_id
    where (p_story_id is null or n.story_id = p_story_id)
      and (p_status = 'all' or n.status = p_status)
      and exists (
          select 1
          from public.story_creators sc
          where sc.story_id = n.story_id
            and sc.creator_id = v_user_id
            and sc.role in ('owner', 'author', 'editor')
      );

    return v_result;
end;
$$;


ALTER FUNCTION "public"."get_creator_author_notes"("p_story_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_creator_moderation_queue"("p_status" "text" DEFAULT 'pending'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_result jsonb;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1
        from public.creator_profiles
        where id = v_user_id
          and status = 'active'
    ) then
        raise exception 'Active creator account required';
    end if;

    if not exists (
        select 1
        from public.story_creators
        where creator_id = v_user_id
          and role in ('owner', 'author', 'editor')
    ) then
        raise exception 'Moderation permission denied';
    end if;

    if p_status is not null
       and p_status not in (
           'all', 'pending', 'reviewed', 'resolved', 'dismissed'
       ) then
        raise exception 'Invalid report status';
    end if;

    with report_items as (
        select
            r.id as report_id,
            r.reporter_id,
            r.target_type,
            r.target_review_id as target_id,
            r.reason,
            r.details,
            r.status,
            r.created_at,
            s.id as story_id,
            s.title as story_title,
            ep.title as episode_title,
            rv.headline as content_title,
            rv.body as content_body,
            rv.user_id as content_author_id
        from public.content_reports r
        join public.reviews rv
            on rv.id = r.target_review_id
        join public.episodes ep
            on ep.id = rv.episode_id
        join public.stories s
            on s.id = ep.story_id
        where r.target_type = 'review'

        union all

        select
            r.id,
            r.reporter_id,
            r.target_type,
            r.target_author_reply_id,
            r.reason,
            r.details,
            r.status,
            r.created_at,
            s.id,
            s.title,
            ep.title,
            null::text,
            ar.body,
            ar.creator_id
        from public.content_reports r
        join public.author_replies ar
            on ar.id = r.target_author_reply_id
        join public.reviews rv
            on rv.id = ar.review_id
        join public.episodes ep
            on ep.id = rv.episode_id
        join public.stories s
            on s.id = ep.story_id
        where r.target_type = 'author_reply'

        union all

        select
            r.id,
            r.reporter_id,
            r.target_type,
            r.target_author_note_id,
            r.reason,
            r.details,
            r.status,
            r.created_at,
            s.id,
            s.title,
            ep.title,
            an.title,
            an.body,
            an.creator_id
        from public.content_reports r
        join public.author_notes an
            on an.id = r.target_author_note_id
        join public.stories s
            on s.id = an.story_id
        left join public.episodes ep
            on ep.id = an.episode_id
        where r.target_type = 'author_note'
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'report_id', ri.report_id,
                'target_type', ri.target_type,
                'target_id', ri.target_id,
                'reason', ri.reason,
                'details', ri.details,
                'status', ri.status,
                'created_at', ri.created_at,
                'story', jsonb_build_object(
                    'id', ri.story_id,
                    'title', ri.story_title
                ),
                'episode_title', ri.episode_title,
                'content', jsonb_build_object(
                    'title', ri.content_title,
                    'body', ri.content_body,
                    'author', jsonb_build_object(
                        'username', author.username,
                        'display_name', author.display_name
                    )
                ),
                'reporter', jsonb_build_object(
                    'username', reporter.username,
                    'display_name', reporter.display_name
                )
            )
            order by ri.created_at desc
        ),
        '[]'::jsonb
    )
    into v_result
    from report_items ri
    join public.story_creators sc
        on sc.story_id = ri.story_id
       and sc.creator_id = v_user_id
       and sc.role in ('owner', 'author', 'editor')
    left join public.profiles reporter
        on reporter.id = ri.reporter_id
    left join public.profiles author
        on author.id = ri.content_author_id
    where p_status is null
       or p_status = 'all'
       or ri.status = p_status;

    return v_result;
end;
$$;


ALTER FUNCTION "public"."get_creator_moderation_queue"("p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_creator_story_workspace"("p_story_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

    -- Confirm the creator is assigned to this story.
    select sc.role
    into v_role
    from public.story_creators sc
    where sc.story_id = p_story_id
      and sc.creator_id = v_user_id;

    if v_role is null then
        raise exception 'You do not have access to this story';
    end if;

    -- Retrieve story metadata.
    select to_jsonb(s)
    into v_story
    from public.stories s
    where s.id = p_story_id;

    if v_story is null then
        raise exception 'Story not found';
    end if;

    -- Retrieve optional seasons.
    select coalesce(
        jsonb_agg(to_jsonb(s) order by s.id),
        '[]'::jsonb
    )
    into v_seasons
    from public.seasons s
    where s.story_id = p_story_id;

    -- Retrieve every episode and its latest revision metadata.
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
$$;


ALTER FUNCTION "public"."get_creator_story_workspace"("p_story_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_notification_preferences"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_preferences public.notification_preferences%rowtype;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    insert into public.notification_preferences (user_id)
    values (v_user_id)
    on conflict (user_id) do nothing;

    select *
    into v_preferences
    from public.notification_preferences
    where user_id = v_user_id;

    return jsonb_build_object(
        'new_episodes', v_preferences.new_episodes,
        'author_replies', v_preferences.author_replies,
        'author_notes', v_preferences.author_notes,
        'saved_story_updates', v_preferences.saved_story_updates
    );
end;
$$;


ALTER FUNCTION "public"."get_my_notification_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_notifications"("p_limit" integer DEFAULT 50, "p_unread_only" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_notifications jsonb;
    v_unread_count integer;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_limit is null or p_limit < 1 or p_limit > 100 then
        raise exception 'Limit must be between 1 and 100';
    end if;

    select count(*)
    into v_unread_count
    from public.notifications
    where user_id = v_user_id
      and read_at is null;

    select coalesce(
        jsonb_agg(
            to_jsonb(n)
            order by n.created_at desc
        ),
        '[]'::jsonb
    )
    into v_notifications
    from (
        select *
        from public.notifications
        where user_id = v_user_id
          and (not p_unread_only or read_at is null)
        order by created_at desc
        limit p_limit
    ) n;

    return jsonb_build_object(
        'notifications', v_notifications,
        'unread_count', v_unread_count
    );
end;
$$;


ALTER FUNCTION "public"."get_my_notifications"("p_limit" integer, "p_unread_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grant_next_episode"("p_user_id" "uuid", "p_source_episode_id" "uuid", "p_participation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_source_story_id uuid;
    v_source_sequence integer;

    v_next_id uuid;
    v_next_title text;
    v_next_status text;

    v_granted boolean := false;
begin
    -- Identify the story and position of the episode
    -- where the reader contributed.
    select e.story_id, e.sequence_number
    into v_source_story_id, v_source_sequence
    from public.episodes e
    where e.id = p_source_episode_id;

    if not found then
        raise exception 'Source episode not found.';
    end if;

    -- Find the next eligible episode, allowing gaps
    -- in numbering and skipping withdrawn episodes.
    select e.id, e.title, e.publication_status
    into v_next_id, v_next_title, v_next_status
    from public.episodes e
    where e.story_id = v_source_story_id
      and e.sequence_number > v_source_sequence
      and e.publication_status <> 'withdrawn'
    order by e.sequence_number asc
    limit 1;

    if not found then
        return jsonb_build_object(
            'granted', false,
            'newly_granted', false,
            'next_episode', null,
            'reason', 'no_next_episode_available'
        );
    end if;

    -- Create an entitlement only if one does not
    -- already exist for this reader and episode.
    insert into public.episode_entitlements (
        user_id,
        episode_id,
        grant_reason,
        source_episode_id
    )
    values (
        p_user_id,
        v_next_id,
        'reader_contribution',
        p_source_episode_id
    )
    on conflict (user_id, episode_id) do nothing;

    v_granted := found;

    -- Only record a contribution unlock when this
    -- contribution actually created the entitlement.
    if v_granted then
        insert into public.episode_unlock_events (
            user_id,
            source_episode_id,
            unlocked_episode_id,
            participation_id
        )
        values (
            p_user_id,
            p_source_episode_id,
            v_next_id,
            p_participation_id
        )
        on conflict (user_id, unlocked_episode_id) do nothing;
    end if;

    return jsonb_build_object(
        'granted', true,
        'newly_granted', v_granted,
        'next_episode', jsonb_build_object(
            'id', v_next_id,
            'title', v_next_title,
            'publication_status', v_next_status,
            'access_status',
                case
                    when v_next_status = 'published'
                    then 'unlocked'
                    else 'unlocked_when_published'
                end
        )
    );
end;
$$;


ALTER FUNCTION "public"."grant_next_episode"("p_user_id" "uuid", "p_source_episode_id" "uuid", "p_participation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        nullif(new.raw_user_meta_data ->> 'display_name', '')
    )
    on conflict (id) do nothing;

    return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_read"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_updated_count integer;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    update public.notifications
    set read_at = now()
    where user_id = v_user_id
      and read_at is null;

    get diagnostics v_updated_count = row_count;

    return jsonb_build_object(
        'updated_count', v_updated_count
    );
end;
$$;


ALTER FUNCTION "public"."mark_all_notifications_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_notification public.notifications%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    update public.notifications
    set read_at = coalesce(read_at, now())
    where id = p_notification_id
      and user_id = v_user_id
    returning * into v_notification;

    if not found then
        raise exception 'Notification not found';
    end if;

    return jsonb_build_object(
        'notification_id', v_notification.id,
        'read_at', v_notification.read_at
    );
end;
$$;


ALTER FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."moderate_content_report"("p_report_id" "uuid", "p_decision" "text", "p_hide_content" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_report public.content_reports%rowtype;
    v_story_id uuid;
    v_rows integer;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_decision not in ('reviewed', 'resolved', 'dismissed') then
        raise exception 'Invalid moderation decision';
    end if;

    if p_hide_content and p_decision <> 'resolved' then
        raise exception 'Content can only be hidden when resolving a report';
    end if;

    if not exists (
        select 1
        from public.creator_profiles
        where id = v_user_id
          and status = 'active'
    ) then
        raise exception 'Active creator account required';
    end if;

    select *
    into v_report
    from public.content_reports
    where id = p_report_id
    for update;

    if not found then
        raise exception 'Report not found';
    end if;

    if v_report.status not in ('pending', 'reviewed') then
        raise exception 'This report has already been closed';
    end if;

    if v_report.target_type = 'review' then
        select ep.story_id
        into v_story_id
        from public.reviews rv
        join public.episodes ep on ep.id = rv.episode_id
        where rv.id = v_report.target_review_id;

    elsif v_report.target_type = 'author_reply' then
        select ep.story_id
        into v_story_id
        from public.author_replies ar
        join public.reviews rv on rv.id = ar.review_id
        join public.episodes ep on ep.id = rv.episode_id
        where ar.id = v_report.target_author_reply_id;

    elsif v_report.target_type = 'author_note' then
        select story_id
        into v_story_id
        from public.author_notes
        where id = v_report.target_author_note_id;
    end if;

    if v_story_id is null or not exists (
        select 1
        from public.story_creators
        where story_id = v_story_id
          and creator_id = v_user_id
          and role in ('owner', 'author', 'editor')
    ) then
        raise exception 'Moderation permission denied for this story';
    end if;

    if p_hide_content then
        if v_report.target_type = 'review' then
            update public.reviews
            set status = 'hidden',
                updated_at = now()
            where id = v_report.target_review_id
              and status <> 'deleted';

        elsif v_report.target_type = 'author_reply' then
            update public.author_replies
            set status = 'hidden',
                updated_at = now()
            where id = v_report.target_author_reply_id;

        elsif v_report.target_type = 'author_note' then
            update public.author_notes
            set status = 'withdrawn',
                updated_at = now()
            where id = v_report.target_author_note_id;
        end if;

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
            raise exception 'Content could not be hidden';
        end if;
    end if;

    update public.content_reports
    set status = p_decision,
        reviewed_by = v_user_id,
        reviewed_at = now()
    where id = p_report_id;

    return jsonb_build_object(
        'report_id', p_report_id,
        'decision', p_decision,
        'content_hidden', p_hide_content,
        'reviewed_at', now()
    );
end;
$$;


ALTER FUNCTION "public"."moderate_content_report"("p_report_id" "uuid", "p_decision" "text", "p_hide_content" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_author_note_published"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_story_title text;
begin
    if new.status <> 'published' then
        return new;
    end if;

    if tg_op = 'UPDATE'
       and old.status = 'published' then
        return new;
    end if;

    select s.title
    into v_story_title
    from public.stories s
    where s.id = new.story_id;

    insert into public.notifications (
        user_id,
        notification_type,
        title,
        body,
        payload
    )
    select distinct
        readers.user_id,
        'author_note',
        'A new author note',
        'The author has shared a new note about ' || v_story_title || '.',
        jsonb_build_object(
            'story_id', new.story_id,
            'author_note_id', new.id,
            'episode_id', new.episode_id
        )
    from (
        select b.user_id
        from public.bookmarks b
        where b.story_id = new.story_id

        union

        select rp.user_id
        from public.reading_progress rp
        join public.episodes e on e.id = rp.episode_id
        where e.story_id = new.story_id

        union

        select ee.user_id
        from public.episode_entitlements ee
        join public.episodes e on e.id = ee.episode_id
        where e.story_id = new.story_id
    ) readers
    left join public.notification_preferences np
        on np.user_id = readers.user_id
    where coalesce(np.author_notes, true) = true
      and readers.user_id <> new.creator_id
      and not exists (
          select 1
          from public.story_creators sc
          where sc.story_id = new.story_id
            and sc.creator_id = readers.user_id
      );

    return new;
end;
$$;


ALTER FUNCTION "public"."notify_author_note_published"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_author_reply_published"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_should_notify boolean := false;
    v_reader_id uuid;
    v_story_id uuid;
    v_story_title text;
begin
    if tg_op = 'INSERT' then
        v_should_notify := (new.status = 'published');
    else
        v_should_notify := (
            new.status = 'published'
            and old.status is distinct from 'published'
        );
    end if;

    if not v_should_notify then
        return new;
    end if;

    select r.user_id, e.story_id, s.title
    into v_reader_id, v_story_id, v_story_title
    from public.reviews r
    join public.episodes e on e.id = r.episode_id
    join public.stories s on s.id = e.story_id
    where r.id = new.review_id
      and r.status = 'submitted'
      and r.visibility = 'public';

    if v_reader_id is null or v_reader_id = new.creator_id then
        return new;
    end if;

    if exists (
        select 1
        from public.notification_preferences np
        where np.user_id = v_reader_id
          and np.author_replies = false
    ) then
        return new;
    end if;

    insert into public.notifications (
        user_id,
        notification_type,
        title,
        body,
        payload
    )
    values (
        v_reader_id,
        'author_reply',
        'The author replied to your review',
        'The author of ' || v_story_title || ' has responded to your contribution.',
        jsonb_build_object(
            'story_id', v_story_id,
            'review_id', new.review_id,
            'reply_id', new.id
        )
    );

    return new;
end;
$$;


ALTER FUNCTION "public"."notify_author_reply_published"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_episode_published"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_story_title text;
begin
    if new.publication_status <> 'published' then
        return new;
    end if;

    if tg_op = 'UPDATE'
       and old.publication_status = 'published' then
        return new;
    end if;

    select s.title
    into v_story_title
    from public.stories s
    where s.id = new.story_id;

    -- Notify readers actively reading or entitled to this story.
    insert into public.notifications (
        user_id,
        notification_type,
        title,
        body,
        payload
    )
    select distinct
        readers.user_id,
        'new_episode',
        'A new episode is here',
        v_story_title || ' has a new episode: ' || new.title,
        jsonb_build_object(
            'story_id', new.story_id,
            'episode_id', new.id,
            'episode_title', new.title
        )
    from (
        select rp.user_id
        from public.reading_progress rp
        join public.episodes e on e.id = rp.episode_id
        where e.story_id = new.story_id

        union

        select ee.user_id
        from public.episode_entitlements ee
        join public.episodes e on e.id = ee.episode_id
        where e.story_id = new.story_id
    ) readers
    left join public.notification_preferences np
        on np.user_id = readers.user_id
    where coalesce(np.new_episodes, true) = true
      and not exists (
          select 1
          from public.story_creators sc
          where sc.story_id = new.story_id
            and sc.creator_id = readers.user_id
      );

    -- Notify saved-story readers who did not already receive
    -- the active-reader notification.
    insert into public.notifications (
        user_id,
        notification_type,
        title,
        body,
        payload
    )
    select distinct
        b.user_id,
        'saved_story_update',
        'A saved story has been updated',
        v_story_title || ' has a new episode: ' || new.title,
        jsonb_build_object(
            'story_id', new.story_id,
            'episode_id', new.id,
            'episode_title', new.title
        )
    from public.bookmarks b
    left join public.notification_preferences np
        on np.user_id = b.user_id
    where b.story_id = new.story_id
      and coalesce(np.saved_story_updates, true) = true
      and not exists (
          select 1
          from public.story_creators sc
          where sc.story_id = new.story_id
            and sc.creator_id = b.user_id
      )
      and not (
          coalesce((
              select np2.new_episodes
              from public.notification_preferences np2
              where np2.user_id = b.user_id
          ), true) = true
          and (
              exists (
                  select 1
                  from public.reading_progress rp
                  join public.episodes e on e.id = rp.episode_id
                  where rp.user_id = b.user_id
                    and e.story_id = new.story_id
              )
              or exists (
                  select 1
                  from public.episode_entitlements ee
                  join public.episodes e on e.id = ee.episode_id
                  where ee.user_id = b.user_id
                    and e.story_id = new.story_id
              )
          )
      );

    return new;
end;
$$;


ALTER FUNCTION "public"."notify_episode_published"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_author_reply"("p_review_id" "uuid", "p_body" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_story_id uuid;
    v_reply public.author_replies%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_body is null
       or length(trim(p_body)) = 0
       or length(p_body) > 10000 then
        raise exception 'Reply must contain between 1 and 10000 characters';
    end if;

    if not exists (
        select 1
        from public.creator_profiles
        where id = v_user_id
          and status = 'active'
    ) then
        raise exception 'Active creator account required';
    end if;

    select ep.story_id
    into v_story_id
    from public.reviews rv
    join public.episodes ep on ep.id = rv.episode_id
    where rv.id = p_review_id
      and rv.status = 'submitted'
      and rv.visibility = 'public';

    if v_story_id is null then
        raise exception 'Public submitted review not found';
    end if;

    if not exists (
        select 1
        from public.story_creators
        where story_id = v_story_id
          and creator_id = v_user_id
          and role in ('owner', 'author', 'editor')
    ) then
        raise exception 'You cannot reply to reviews for this story';
    end if;

    insert into public.author_replies (
        review_id,
        creator_id,
        body,
        status
    )
    values (
        p_review_id,
        v_user_id,
        trim(p_body),
        'published'
    )
    on conflict (review_id, creator_id)
    do update set
        body = excluded.body,
        status = 'published',
        updated_at = now()
    returning * into v_reply;

    return jsonb_build_object(
        'reply_id', v_reply.id,
        'review_id', v_reply.review_id,
        'status', v_reply.status,
        'body', v_reply.body,
        'updated_at', v_reply.updated_at
    );
end;
$$;


ALTER FUNCTION "public"."publish_author_reply"("p_review_id" "uuid", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_creator_episode"("p_episode_id" "uuid", "p_revision_id" "uuid", "p_action" "text", "p_scheduled_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

    -- Cancel an existing scheduled publication.
    if p_action = 'cancel_schedule' then

        update public.episode_publication_queue
        set status = 'cancelled'
        where episode_id = p_episode_id
          and status = 'scheduled';

        if v_episode.publication_status = 'scheduled' then
            update public.episodes
            set
                publication_status = 'draft',
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

    -- Validate selected revision.
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

        -- Replace any previous scheduled publication for this episode.
        update public.episode_publication_queue
        set status = 'cancelled'
        where episode_id = p_episode_id
          and status = 'scheduled';

        insert into public.episode_publication_queue (
            episode_id,
            revision_id,
            scheduled_at,
            created_by
        )
        values (
            p_episode_id,
            p_revision_id,
            p_scheduled_at,
            v_user_id
        )
        returning id into v_queue_id;

        -- A new episode becomes scheduled.
        -- An already published episode remains published until replacement.
        if v_episode.publication_status <> 'published' then
            update public.episodes
            set
                publication_status = 'scheduled',
                scheduled_at = p_scheduled_at
            where id = p_episode_id;
        else
            update public.episodes
            set scheduled_at = p_scheduled_at
            where id = p_episode_id;
        end if;

        insert into public.publication_history (
            story_id,
            episode_id,
            actor_id,
            event_type,
            details
        )
        values (
            v_story_id,
            p_episode_id,
            v_user_id,
            'episode_scheduled',
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

    -- Immediate publication.
    update public.episode_publication_queue
    set status = 'cancelled'
    where episode_id = p_episode_id
      and status = 'scheduled';

    update public.episodes
    set
        title = v_revision.title,
        synopsis = v_revision.synopsis,
        content = v_revision.content,
        publication_status = 'published',
        published_at = now(),
        scheduled_at = null
    where id = p_episode_id;

    update public.episode_revisions
    set
        revision_status = 'published',
        published_at = now()
    where id = p_revision_id;

    insert into public.publication_history (
        story_id,
        episode_id,
        actor_id,
        event_type,
        details
    )
    values (
        v_story_id,
        p_episode_id,
        v_user_id,
        'episode_published',
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


ALTER FUNCTION "public"."publish_creator_episode"("p_episode_id" "uuid", "p_revision_id" "uuid", "p_action" "text", "p_scheduled_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_creator_story"("p_story_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."publish_creator_story"("p_story_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_due_author_notes"("p_limit" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_note public.author_notes%rowtype;
    v_count integer := 0;
    v_published_ids jsonb := '[]'::jsonb;
begin
    if p_limit is null or p_limit < 1 or p_limit > 500 then
        raise exception 'Limit must be between 1 and 500';
    end if;

    for v_note in
        select *
        from public.author_notes
        where status = 'scheduled'
          and scheduled_at <= now()
        order by scheduled_at, id
        limit p_limit
        for update skip locked
    loop
        update public.author_notes
        set status = 'published',
            published_at = now(),
            scheduled_at = null,
            updated_at = now()
        where id = v_note.id
        returning * into v_note;

        insert into public.publication_history (
            story_id,
            episode_id,
            actor_id,
            event_type,
            details
        )
        values (
            v_note.story_id,
            v_note.episode_id,
            v_note.creator_id,
            'author_note_published',
            jsonb_build_object(
                'note_id', v_note.id,
                'scheduled_at', v_note.scheduled_at,
                'published_at', v_note.published_at,
                'automatic', true
            )
        );

        v_count := v_count + 1;
        v_published_ids := v_published_ids || jsonb_build_array(v_note.id);
    end loop;

    return jsonb_build_object(
        'published_count', v_count,
        'published_note_ids', v_published_ids
    );
end;
$$;


ALTER FUNCTION "public"."publish_due_author_notes"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_due_episodes"("p_limit" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
            er.synopsis,
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

        update public.episodes
        set
            title = v_item.title,
            synopsis = v_item.synopsis,
            content = v_item.content,
            publication_status = 'published',
            published_at = now(),
            scheduled_at = null
        where id = v_item.episode_id;

        update public.episode_revisions
        set
            revision_status = 'published',
            published_at = now()
        where id = v_item.revision_id;

        update public.episode_publication_queue
        set
            status = 'published',
            published_at = now()
        where id = v_item.queue_id;

        insert into public.publication_history (
            story_id,
            episode_id,
            actor_id,
            event_type,
            details
        )
        values (
            v_item.story_id,
            v_item.episode_id,
            null,
            'episode_published',
            jsonb_build_object(
                'revision_id', v_item.revision_id,
                'revision_number', v_item.revision_number,
                'automatic', true
            )
        );

        v_count := v_count + 1;
    end loop;

    return jsonb_build_object(
        'published_count', v_count
    );
end;
$$;


ALTER FUNCTION "public"."publish_due_episodes"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_creator_episode_image"("p_episode_id" "uuid", "p_storage_path" "text", "p_alt_text" "text" DEFAULT NULL::"text", "p_position" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."register_creator_episode_image"("p_episode_id" "uuid", "p_storage_path" "text", "p_alt_text" "text", "p_position" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_review_helpful_vote"("p_review_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_removed boolean;
    v_count integer;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    delete from public.review_helpful_votes
    where user_id = v_user_id
      and review_id = p_review_id;

    v_removed := found;

    select count(*)::integer
    into v_count
    from public.review_helpful_votes
    where review_id = p_review_id;

    return jsonb_build_object(
        'review_id', p_review_id,
        'helpful', false,
        'removed', v_removed,
        'helpful_count', v_count
    );
end;
$$;


ALTER FUNCTION "public"."remove_review_helpful_vote"("p_review_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_story_bookmark"("p_story_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_removed boolean;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    delete from public.bookmarks
    where user_id = v_user_id
      and story_id = p_story_id;

    v_removed := found;

    return jsonb_build_object(
        'story_id', p_story_id,
        'saved', false,
        'removed', v_removed
    );
end;
$$;


ALTER FUNCTION "public"."remove_story_bookmark"("p_story_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_content"("p_target_type" "text", "p_target_id" "uuid", "p_reason" "text", "p_details" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_report_id uuid;
    v_owner_id uuid;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_target_type not in (
        'review',
        'author_reply',
        'author_note'
    ) then
        raise exception 'Invalid content type';
    end if;

    if p_reason not in (
        'spam',
        'harassment',
        'hate',
        'spoiler',
        'inappropriate',
        'misinformation',
        'other'
    ) then
        raise exception 'Invalid report reason';
    end if;

    if p_details is not null
       and length(p_details) > 5000 then
        raise exception 'Report details are too long';
    end if;

    if p_target_type = 'review' then
        select user_id
        into v_owner_id
        from public.reviews
        where id = p_target_id
          and status = 'submitted'
          and visibility = 'public';

    elsif p_target_type = 'author_reply' then
        select creator_id
        into v_owner_id
        from public.author_replies
        where id = p_target_id
          and status = 'published';

    elsif p_target_type = 'author_note' then
        select creator_id
        into v_owner_id
        from public.author_notes
        where id = p_target_id
          and status = 'published';
    end if;

    if v_owner_id is null then
        raise exception 'Content not found or not reportable';
    end if;

    if v_owner_id = v_user_id then
        raise exception 'You cannot report your own content';
    end if;

    insert into public.content_reports (
        reporter_id,
        target_type,
        target_review_id,
        target_author_reply_id,
        target_author_note_id,
        reason,
        details,
        status
    )
    values (
        v_user_id,
        p_target_type,
        case when p_target_type = 'review'
            then p_target_id else null end,
        case when p_target_type = 'author_reply'
            then p_target_id else null end,
        case when p_target_type = 'author_note'
            then p_target_id else null end,
        p_reason,
        nullif(trim(p_details), ''),
        'pending'
    )
    returning id into v_report_id;

    return jsonb_build_object(
        'report_id', v_report_id,
        'target_type', p_target_type,
        'status', 'pending'
    );
end;
$$;


ALTER FUNCTION "public"."report_content"("p_target_type" "text", "p_target_id" "uuid", "p_reason" "text", "p_details" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_author_note"("p_story_id" "uuid", "p_body" "text", "p_action" "text", "p_note_id" "uuid" DEFAULT NULL::"uuid", "p_episode_id" "uuid" DEFAULT NULL::"uuid", "p_title" "text" DEFAULT NULL::"text", "p_scheduled_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_note public.author_notes%rowtype;
    v_previous_status text;
    v_new_status text;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1
        from public.creator_profiles
        where id = v_user_id
          and status = 'active'
    ) then
        raise exception 'Active creator account required';
    end if;

    if not exists (
        select 1
        from public.story_creators
        where story_id = p_story_id
          and creator_id = v_user_id
          and role in ('owner', 'author', 'editor')
    ) then
        raise exception 'You cannot manage notes for this story';
    end if;

    if p_body is null
       or length(trim(p_body)) = 0
       or length(p_body) > 50000 then
        raise exception 'Note body must contain between 1 and 50000 characters';
    end if;

    if p_action not in ('draft', 'publish', 'schedule', 'withdraw') then
        raise exception 'Invalid note action';
    end if;

    if p_episode_id is not null and not exists (
        select 1
        from public.episodes
        where id = p_episode_id
          and story_id = p_story_id
    ) then
        raise exception 'Episode does not belong to this story';
    end if;

    if p_action = 'schedule' and (
        p_scheduled_at is null or p_scheduled_at <= now()
    ) then
        raise exception 'Scheduled publication must be in the future';
    end if;

    if p_action <> 'schedule' and p_scheduled_at is not null then
        raise exception 'Scheduled time is only valid for scheduled notes';
    end if;

    if p_action = 'withdraw' and p_note_id is null then
        raise exception 'A note ID is required to withdraw a note';
    end if;

    if p_note_id is not null then
        select *
        into v_note
        from public.author_notes
        where id = p_note_id
          and story_id = p_story_id
        for update;

        if not found then
            raise exception 'Author note not found';
        end if;

        v_previous_status := v_note.status;

        if p_action = 'withdraw' then
            update public.author_notes
            set status = 'withdrawn',
                scheduled_at = null,
                updated_at = now()
            where id = p_note_id
            returning * into v_note;
        else
            v_new_status := case p_action
                when 'draft' then 'draft'
                when 'publish' then 'published'
                when 'schedule' then 'scheduled'
            end;

            update public.author_notes
            set title = nullif(trim(p_title), ''),
                body = trim(p_body),
                status = v_new_status,
                scheduled_at = case
                    when p_action = 'schedule' then p_scheduled_at
                    else null
                end,
                published_at = case
                    when p_action = 'publish' then coalesce(published_at, now())
                    else null
                end,
                updated_at = now()
            where id = p_note_id
            returning * into v_note;
        end if;
    else
        if p_action = 'withdraw' then
            raise exception 'Cannot withdraw a note that has not been created';
        end if;

        v_new_status := case p_action
            when 'draft' then 'draft'
            when 'publish' then 'published'
            when 'schedule' then 'scheduled'
        end;

        insert into public.author_notes (
            story_id,
            episode_id,
            creator_id,
            title,
            body,
            status,
            scheduled_at,
            published_at
        )
        values (
            p_story_id,
            p_episode_id,
            v_user_id,
            nullif(trim(p_title), ''),
            trim(p_body),
            v_new_status,
            case when p_action = 'schedule' then p_scheduled_at else null end,
            case when p_action = 'publish' then now() else null end
        )
        returning * into v_note;

        v_previous_status := null;
    end if;

    insert into public.publication_history (
        story_id,
        episode_id,
        actor_id,
        event_type,
        details
    )
    values (
        v_note.story_id,
        v_note.episode_id,
        v_user_id,
        'author_note_' || v_note.status,
        jsonb_build_object(
            'note_id', v_note.id,
            'previous_status', v_previous_status,
            'new_status', v_note.status
        )
    );

    return jsonb_build_object(
        'note_id', v_note.id,
        'story_id', v_note.story_id,
        'episode_id', v_note.episode_id,
        'title', v_note.title,
        'body', v_note.body,
        'status', v_note.status,
        'is_pinned', v_note.is_pinned,
        'scheduled_at', v_note.scheduled_at,
        'published_at', v_note.published_at,
        'updated_at', v_note.updated_at
    );
end;
$$;


ALTER FUNCTION "public"."save_author_note"("p_story_id" "uuid", "p_body" "text", "p_action" "text", "p_note_id" "uuid", "p_episode_id" "uuid", "p_title" "text", "p_scheduled_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_creator_episode"("p_episode_id" "uuid", "p_story_id" "uuid", "p_season_id" "uuid", "p_sequence_number" integer, "p_title" "text", "p_synopsis" "text", "p_content" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
        select 1
        from public.seasons s
        where s.id = p_season_id
          and s.story_id = p_story_id
    ) then
        raise exception 'Season does not belong to this story';
    end if;

    if p_episode_id is null then

        insert into public.episodes (
            story_id,
            season_id,
            sequence_number,
            title,
            synopsis,
            content,
            publication_status
        )
        values (
            p_story_id,
            p_season_id,
            p_sequence_number,
            trim(p_title),
            nullif(trim(p_synopsis), ''),
            p_content,
            'draft'
        )
        returning id into v_episode_id;

        v_is_new := true;
        v_publication_status := 'draft';

    else

        select e.publication_status
        into v_publication_status
        from public.episodes e
        where e.id = p_episode_id
          and e.story_id = p_story_id
        for update;

        if not found then
            raise exception 'Episode not found in this story';
        end if;

        v_episode_id := p_episode_id;

        -- Published content stays untouched until explicitly published.
        -- Scheduled episodes also retain their current published schedule.
        if v_publication_status not in ('published', 'scheduled') then
            update public.episodes
            set
                season_id = p_season_id,
                sequence_number = p_sequence_number,
                title = trim(p_title),
                synopsis = nullif(trim(p_synopsis), ''),
                content = p_content,
                publication_status = 'draft',
                scheduled_at = null
            where id = v_episode_id;

            v_publication_status := 'draft';
        end if;

    end if;

    select coalesce(max(er.revision_number), 0) + 1
    into v_revision_number
    from public.episode_revisions er
    where er.episode_id = v_episode_id;

    insert into public.episode_revisions (
        episode_id,
        revision_number,
        title,
        synopsis,
        content,
        revision_status,
        created_by
    )
    values (
        v_episode_id,
        v_revision_number,
        trim(p_title),
        nullif(trim(p_synopsis), ''),
        p_content,
        'draft',
        v_user_id
    );

    insert into public.publication_history (
        story_id,
        episode_id,
        actor_id,
        event_type,
        details
    )
    values (
        p_story_id,
        v_episode_id,
        v_user_id,
        'episode_draft_saved',
        jsonb_build_object(
            'revision_number', v_revision_number,
            'title', trim(p_title)
        )
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


ALTER FUNCTION "public"."save_creator_episode"("p_episode_id" "uuid", "p_story_id" "uuid", "p_season_id" "uuid", "p_sequence_number" integer, "p_title" "text", "p_synopsis" "text", "p_content" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_creator_story"("p_story_id" "uuid", "p_title" "text", "p_slug" "text", "p_tagline" "text", "p_synopsis" "text", "p_first_episode_free" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
    v_user_id uuid := auth.uid();
    v_story_id uuid;
    v_role text;
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

    if p_title is null or length(trim(p_title)) = 0 then
        raise exception 'Story title is required';
    end if;

    if p_slug is null
       or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
        raise exception 'Invalid story slug';
    end if;

    if p_first_episode_free is null then
        raise exception 'First episode access setting is required';
    end if;

    if p_story_id is null then

        insert into public.stories (
            slug,
            title,
            tagline,
            synopsis,
            publication_status,
            first_episode_free,
            created_by
        )
        values (
            p_slug,
            trim(p_title),
            nullif(trim(p_tagline), ''),
            nullif(trim(p_synopsis), ''),
            'draft',
            p_first_episode_free,
            v_user_id
        )
        returning id into v_story_id;

        insert into public.story_creators (
            story_id,
            creator_id,
            role
        )
        values (
            v_story_id,
            v_user_id,
            'owner'
        );

        insert into public.publication_history (
            story_id,
            actor_id,
            event_type,
            details
        )
        values (
            v_story_id,
            v_user_id,
            'story_created',
            jsonb_build_object('title', trim(p_title))
        );

    else

        select sc.role
        into v_role
        from public.story_creators sc
        where sc.story_id = p_story_id
          and sc.creator_id = v_user_id
          and sc.role in ('owner', 'author', 'editor');

        if v_role is null then
            raise exception 'You do not have permission to edit this story';
        end if;

        update public.stories
        set
            title = trim(p_title),
            slug = p_slug,
            tagline = nullif(trim(p_tagline), ''),
            synopsis = nullif(trim(p_synopsis), ''),
            first_episode_free = p_first_episode_free
        where id = p_story_id
        returning id into v_story_id;

        insert into public.publication_history (
            story_id,
            actor_id,
            event_type,
            details
        )
        values (
            v_story_id,
            v_user_id,
            'story_updated',
            jsonb_build_object('title', trim(p_title))
        );

    end if;

    return jsonb_build_object(
        'story_id', v_story_id,
        'title', trim(p_title),
        'slug', p_slug,
        'publication_status', 'draft'
    );
end;
$_$;


ALTER FUNCTION "public"."save_creator_story"("p_story_id" "uuid", "p_title" "text", "p_slug" "text", "p_tagline" "text", "p_synopsis" "text", "p_first_episode_free" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_my_notification_preferences"("p_new_episodes" boolean, "p_author_replies" boolean, "p_author_notes" boolean, "p_saved_story_updates" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_preferences public.notification_preferences%rowtype;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_new_episodes is null
       or p_author_replies is null
       or p_author_notes is null
       or p_saved_story_updates is null then
        raise exception 'All notification preferences must be provided';
    end if;

    insert into public.notification_preferences (
        user_id,
        new_episodes,
        author_replies,
        author_notes,
        saved_story_updates
    )
    values (
        v_user_id,
        p_new_episodes,
        p_author_replies,
        p_author_notes,
        p_saved_story_updates
    )
    on conflict (user_id)
    do update set
        new_episodes = excluded.new_episodes,
        author_replies = excluded.author_replies,
        author_notes = excluded.author_notes,
        saved_story_updates = excluded.saved_story_updates;

    select *
    into v_preferences
    from public.notification_preferences
    where user_id = v_user_id;

    return jsonb_build_object(
        'new_episodes', v_preferences.new_episodes,
        'author_replies', v_preferences.author_replies,
        'author_notes', v_preferences.author_notes,
        'saved_story_updates', v_preferences.saved_story_updates
    );
end;
$$;


ALTER FUNCTION "public"."save_my_notification_preferences"("p_new_episodes" boolean, "p_author_replies" boolean, "p_author_notes" boolean, "p_saved_story_updates" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_reader_preferences"("p_theme" "text", "p_text_size" "text", "p_reading_width" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_preferences public.reader_preferences%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_theme not in ('paper', 'sepia', 'night') then
        raise exception 'Invalid reading theme';
    end if;

    if p_text_size not in ('small', 'comfortable', 'large') then
        raise exception 'Invalid text size';
    end if;

    if p_reading_width not in ('narrow', 'standard', 'wide') then
        raise exception 'Invalid reading width';
    end if;

    insert into public.reader_preferences (
        user_id,
        theme,
        text_size,
        reading_width
    )
    values (
        v_user_id,
        p_theme,
        p_text_size,
        p_reading_width
    )
    on conflict (user_id)
    do update set
        theme = excluded.theme,
        text_size = excluded.text_size,
        reading_width = excluded.reading_width,
        updated_at = now()
    returning * into v_preferences;

    return jsonb_build_object(
        'theme', v_preferences.theme,
        'text_size', v_preferences.text_size,
        'reading_width', v_preferences.reading_width,
        'updated_at', v_preferences.updated_at
    );
end;
$$;


ALTER FUNCTION "public"."save_reader_preferences"("p_theme" "text", "p_text_size" "text", "p_reading_width" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_reading_progress"("p_episode_id" "uuid", "p_progress_percent" numeric, "p_last_position" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_progress public.reading_progress%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_progress_percent is null
       or p_progress_percent < 0
       or p_progress_percent > 100 then
        raise exception 'Progress must be between 0 and 100';
    end if;

    if not public.assert_episode_access(
        v_user_id,
        p_episode_id
    ) then
        raise exception 'Episode access denied';
    end if;

    insert into public.reading_progress (
        user_id,
        episode_id,
        progress_percent,
        last_position,
        started_at,
        completed_at,
        updated_at
    )
    values (
        v_user_id,
        p_episode_id,
        p_progress_percent,
        p_last_position,
        now(),
        case
            when p_progress_percent = 100 then now()
            else null
        end,
        now()
    )
    on conflict (user_id, episode_id)
    do update set
        progress_percent = excluded.progress_percent,
        last_position = coalesce(
            excluded.last_position,
            public.reading_progress.last_position
        ),
        completed_at = coalesce(
            public.reading_progress.completed_at,
            excluded.completed_at
        ),
        updated_at = now()
    returning * into v_progress;

    return jsonb_build_object(
        'episode_id', v_progress.episode_id,
        'progress_percent', v_progress.progress_percent,
        'last_position', v_progress.last_position,
        'started_at', v_progress.started_at,
        'completed_at', v_progress.completed_at,
        'updated_at', v_progress.updated_at
    );
end;
$$;


ALTER FUNCTION "public"."save_reading_progress"("p_episode_id" "uuid", "p_progress_percent" numeric, "p_last_position" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_author_note_pinned"("p_note_id" "uuid", "p_is_pinned" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_note public.author_notes%rowtype;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_is_pinned is null then
        raise exception 'Pin state is required';
    end if;

    if not exists (
        select 1
        from public.creator_profiles
        where id = v_user_id
          and status = 'active'
    ) then
        raise exception 'Active creator account required';
    end if;

    select n.*
    into v_note
    from public.author_notes n
    join public.story_creators sc on sc.story_id = n.story_id
    where n.id = p_note_id
      and sc.creator_id = v_user_id
      and sc.role in ('owner', 'author', 'editor')
    for update of n;

    if not found then
        raise exception 'Author note not found or access denied';
    end if;

    if v_note.status <> 'published' then
        raise exception 'Only published notes can be pinned';
    end if;

    update public.author_notes
    set is_pinned = p_is_pinned,
        updated_at = now()
    where id = p_note_id
    returning * into v_note;

    return jsonb_build_object(
        'note_id', v_note.id,
        'story_id', v_note.story_id,
        'is_pinned', v_note.is_pinned,
        'status', v_note.status,
        'updated_at', v_note.updated_at
    );
end;
$$;


ALTER FUNCTION "public"."set_author_note_pinned"("p_note_id" "uuid", "p_is_pinned" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_creator_story_completion_status"("p_story_id" "uuid", "p_completion_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;

    if p_completion_status not in ('ongoing', 'completed') then
        raise exception 'Completion status must be ongoing or completed.';
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

    update public.stories
       set completion_status = p_completion_status,
           updated_at = now()
     where id = p_story_id;

    if not found then
        raise exception 'Story not found.';
    end if;

    insert into public.publication_history (
        story_id,
        actor_id,
        event_type,
        details
    )
    values (
        p_story_id,
        v_user_id,
        case
            when p_completion_status = 'completed'
                then 'story_marked_completed'
            else 'story_reopened'
        end,
        jsonb_build_object('completion_status', p_completion_status)
    );

    return jsonb_build_object(
        'story_id', p_story_id,
        'completion_status', p_completion_status
    );
end;
$$;


ALTER FUNCTION "public"."set_creator_story_completion_status"("p_story_id" "uuid", "p_completion_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_creator_story_cover"("p_story_id" "uuid", "p_storage_path" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."set_creator_story_cover"("p_story_id" "uuid", "p_storage_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_notification_preferences_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


ALTER FUNCTION "public"."set_notification_preferences_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_episode_reactions"("p_episode_id" "uuid", "p_reaction_codes" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_codes text[] := coalesce(
        p_reaction_codes,
        array[]::text[]
    );

    v_valid_count integer;
    v_participation_id uuid;
    v_next_result jsonb;
    v_was_already_qualified boolean;
begin
    if v_user_id is null then
        raise exception 'Authentication required.'
            using errcode = '28000';
    end if;

    perform public.assert_episode_access(
        v_user_id,
        p_episode_id
    );

    -- Reject duplicate or null reaction codes.
    if array_position(v_codes, null) is not null
       or cardinality(v_codes) <> (
           select count(distinct c)
           from unnest(v_codes) as c
       )
    then
        raise exception 'Invalid or duplicate reaction codes.';
    end if;

    -- Every submitted code must be active and recognised.
    select count(*)
    into v_valid_count
    from public.reaction_definitions rd
    where rd.code = any(v_codes)
      and rd.is_active = true;

    if v_valid_count <> cardinality(v_codes) then
        raise exception 'One or more reactions are invalid or inactive.';
    end if;

    -- Replace the reader's current selections.
    delete from public.reader_reactions rr
    where rr.user_id = v_user_id
      and rr.episode_id = p_episode_id
      and not (rr.reaction_id in (
          select rd.id
          from public.reaction_definitions rd
          where rd.code = any(v_codes)
      ));

    insert into public.reader_reactions (
        user_id,
        episode_id,
        reaction_id
    )
    select
        v_user_id,
        p_episode_id,
        rd.id
    from public.reaction_definitions rd
    where rd.code = any(v_codes)
      and rd.is_active = true
    on conflict (user_id, episode_id, reaction_id)
    do nothing;

    if cardinality(v_codes) > 0 then

        insert into public.episode_participations (
            user_id,
            episode_id,
            qualifying_contribution
        )
        values (
            v_user_id,
            p_episode_id,
            'reaction'
        )
        on conflict (user_id, episode_id) do nothing
        returning id into v_participation_id;

        v_was_already_qualified := v_participation_id is null;

        if v_participation_id is null then
            select ep.id
            into v_participation_id
            from public.episode_participations ep
            where ep.user_id = v_user_id
              and ep.episode_id = p_episode_id;
        end if;

        v_next_result := public.grant_next_episode(
            v_user_id,
            p_episode_id,
            v_participation_id
        );

    else
        v_was_already_qualified := exists (
            select 1
            from public.episode_participations ep
            where ep.user_id = v_user_id
              and ep.episode_id = p_episode_id
        );

        v_next_result := null;
    end if;

    return jsonb_build_object(
        'episode_id', p_episode_id,
        'selected_reactions', to_jsonb(v_codes),
        'qualified', (
            cardinality(v_codes) > 0
            or v_was_already_qualified
        ),
        'already_qualified', v_was_already_qualified,
        'unlock', v_next_result
    );
end;
$$;


ALTER FUNCTION "public"."submit_episode_reactions"("p_episode_id" "uuid", "p_reaction_codes" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_episode_review"("p_episode_id" "uuid", "p_headline" "text", "p_body" "text", "p_visibility" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid := auth.uid();
    v_review_id uuid;
    v_participation_id uuid;
    v_next_result jsonb;
    v_already_qualified boolean;
begin
    if v_user_id is null then
        raise exception 'Authentication required.'
            using errcode = '28000';
    end if;

    perform public.assert_episode_access(
        v_user_id,
        p_episode_id
    );

    if p_body is null or length(trim(p_body)) = 0 then
        raise exception 'A written review cannot be empty.';
    end if;

    if p_visibility not in ('public', 'private') then
        raise exception 'Invalid review visibility.';
    end if;

    -- Create or update the reader's review.
    insert into public.reviews (
        user_id,
        episode_id,
        headline,
        body,
        visibility,
        status,
        submitted_at
    )
    values (
        v_user_id,
        p_episode_id,
        nullif(trim(p_headline), ''),
        p_body,
        p_visibility,
        'submitted',
        now()
    )
    on conflict (user_id, episode_id)
    do update set
        headline = excluded.headline,
        body = excluded.body,
        visibility = excluded.visibility,
        status = 'submitted',
        submitted_at = now(),
        updated_at = now()
    returning id into v_review_id;

    -- Create participation only once.
    insert into public.episode_participations (
        user_id,
        episode_id,
        qualifying_contribution
    )
    values (
        v_user_id,
        p_episode_id,
        'review'
    )
    on conflict (user_id, episode_id) do nothing
    returning id into v_participation_id;

    v_already_qualified := v_participation_id is null;

    if v_participation_id is null then
        select ep.id
        into v_participation_id
        from public.episode_participations ep
        where ep.user_id = v_user_id
          and ep.episode_id = p_episode_id;
    end if;

    v_next_result := public.grant_next_episode(
        v_user_id,
        p_episode_id,
        v_participation_id
    );

    return jsonb_build_object(
        'review_id', v_review_id,
        'episode_id', p_episode_id,
        'visibility', p_visibility,
        'status', 'submitted',
        'qualified', true,
        'already_qualified', v_already_qualified,
        'unlock', v_next_result
    );
end;
$$;


ALTER FUNCTION "public"."submit_episode_review"("p_episode_id" "uuid", "p_headline" "text", "p_body" "text", "p_visibility" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vote_review_helpful"("p_review_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_user_id uuid;
    v_added boolean;
    v_count integer;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if not exists (
        select 1
        from public.reviews
        where id = p_review_id
          and status = 'submitted'
          and visibility = 'public'
          and user_id <> v_user_id
    ) then
        raise exception 'Public review not found or voting not permitted';
    end if;

    insert into public.review_helpful_votes (
        user_id,
        review_id
    )
    values (
        v_user_id,
        p_review_id
    )
    on conflict (user_id, review_id) do nothing;

    v_added := found;

    select count(*)::integer
    into v_count
    from public.review_helpful_votes
    where review_id = p_review_id;

    return jsonb_build_object(
        'review_id', p_review_id,
        'helpful', true,
        'added', v_added,
        'helpful_count', v_count
    );
end;
$$;


ALTER FUNCTION "public"."vote_review_helpful"("p_review_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."author_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "story_id" "uuid" NOT NULL,
    "episode_id" "uuid",
    "creator_id" "uuid" NOT NULL,
    "title" "text",
    "body" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "scheduled_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "author_notes_body_check" CHECK (("length"(TRIM(BOTH FROM "body")) > 0)),
    CONSTRAINT "author_notes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'published'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."author_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."author_replies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_id" "uuid" NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "status" "text" DEFAULT 'published'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "author_replies_body_check" CHECK (("length"(TRIM(BOTH FROM "body")) > 0)),
    CONSTRAINT "author_replies_status_check" CHECK (("status" = ANY (ARRAY['published'::"text", 'hidden'::"text"])))
);


ALTER TABLE "public"."author_replies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookmarks" (
    "user_id" "uuid" NOT NULL,
    "story_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bookmarks" OWNER TO "postgres";


COMMENT ON TABLE "public"."bookmarks" IS 'Stories saved by readers in their personal libraries.';



CREATE TABLE IF NOT EXISTS "public"."collection_items" (
    "collection_id" "uuid" NOT NULL,
    "story_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "collection_position_positive" CHECK (("position" > 0))
);


ALTER TABLE "public"."collection_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_review_id" "uuid",
    "target_author_reply_id" "uuid",
    "target_author_note_id" "uuid",
    "reason" "text" NOT NULL,
    "details" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_reports_exactly_one_target" CHECK (((("target_type" = 'review'::"text") AND ("target_review_id" IS NOT NULL) AND ("target_author_reply_id" IS NULL) AND ("target_author_note_id" IS NULL)) OR (("target_type" = 'author_reply'::"text") AND ("target_review_id" IS NULL) AND ("target_author_reply_id" IS NOT NULL) AND ("target_author_note_id" IS NULL)) OR (("target_type" = 'author_note'::"text") AND ("target_review_id" IS NULL) AND ("target_author_reply_id" IS NULL) AND ("target_author_note_id" IS NOT NULL)))),
    CONSTRAINT "content_reports_reason_check" CHECK (("reason" = ANY (ARRAY['spam'::"text", 'harassment'::"text", 'hate'::"text", 'spoiler'::"text", 'inappropriate'::"text", 'misinformation'::"text", 'other'::"text"]))),
    CONSTRAINT "content_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'reviewed'::"text", 'resolved'::"text", 'dismissed'::"text"]))),
    CONSTRAINT "content_reports_target_type_check" CHECK (("target_type" = ANY (ARRAY['review'::"text", 'author_reply'::"text", 'author_note'::"text"])))
);


ALTER TABLE "public"."content_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."creator_profiles" (
    "id" "uuid" NOT NULL,
    "bio" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "creator_status_valid" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."creator_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episode_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "asset_type" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "alt_text" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "episode_assets_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['cover'::"text", 'inline_image'::"text", 'audio'::"text", 'attachment'::"text"])))
);


ALTER TABLE "public"."episode_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episode_entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "grant_reason" "text" NOT NULL,
    "source_episode_id" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "entitlement_reason_valid" CHECK (("grant_reason" = ANY (ARRAY['first_episode'::"text", 'reader_contribution'::"text", 'purchase'::"text", 'creator_grant'::"text", 'admin_grant'::"text"])))
);


ALTER TABLE "public"."episode_entitlements" OWNER TO "postgres";


COMMENT ON TABLE "public"."episode_entitlements" IS 'Authoritative records of reader access grants.';



CREATE TABLE IF NOT EXISTS "public"."episode_participations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "qualifying_contribution" "text" NOT NULL,
    "first_contributed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "participation_type_valid" CHECK (("qualifying_contribution" = ANY (ARRAY['reaction'::"text", 'review'::"text"])))
);


ALTER TABLE "public"."episode_participations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episode_publication_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "revision_id" "uuid" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "created_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    CONSTRAINT "episode_publication_queue_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'published'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."episode_publication_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episode_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "revision_number" integer NOT NULL,
    "title" "text" NOT NULL,
    "synopsis" "text",
    "content" "jsonb" NOT NULL,
    "revision_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    CONSTRAINT "episode_revisions_revision_number_check" CHECK (("revision_number" > 0)),
    CONSTRAINT "episode_revisions_revision_status_check" CHECK (("revision_status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."episode_revisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episode_unlock_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_episode_id" "uuid" NOT NULL,
    "unlocked_episode_id" "uuid" NOT NULL,
    "participation_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."episode_unlock_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "story_id" "uuid" NOT NULL,
    "season_id" "uuid",
    "sequence_number" integer NOT NULL,
    "title" "text" NOT NULL,
    "synopsis" "text",
    "content" "jsonb",
    "publication_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "scheduled_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "episode_sequence_positive" CHECK (("sequence_number" > 0)),
    CONSTRAINT "episode_status_valid" CHECK (("publication_status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'published'::"text", 'withdrawn'::"text"]))),
    CONSTRAINT "episode_title_not_empty" CHECK (("length"(TRIM(BOTH FROM "title")) > 0))
);


ALTER TABLE "public"."episodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "user_id" "uuid" NOT NULL,
    "new_episodes" boolean DEFAULT true NOT NULL,
    "author_replies" boolean DEFAULT true NOT NULL,
    "author_notes" boolean DEFAULT true NOT NULL,
    "story_updates" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notification_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_key" "text"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text",
    "display_name" "text",
    "avatar_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_username_format" CHECK ((("username" IS NULL) OR ("username" ~ '^[a-zA-Z0-9_]{3,30}$'::"text")))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."publication_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "story_id" "uuid" NOT NULL,
    "episode_id" "uuid",
    "actor_id" "uuid",
    "event_type" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "publication_history_event_type_check" CHECK (("event_type" = ANY (ARRAY['story_created'::"text", 'story_published'::"text", 'story_archived'::"text", 'episode_created'::"text", 'episode_published'::"text", 'episode_scheduled'::"text", 'episode_withdrawn'::"text", 'episode_revised'::"text", 'episode_reordered'::"text"])))
);


ALTER TABLE "public"."publication_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reaction_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "statement" "text" NOT NULL,
    "emoji" "text",
    "category" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reaction_code_format" CHECK (("code" ~ '^[a-z0-9_]+$'::"text"))
);


ALTER TABLE "public"."reaction_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reader_preferences" (
    "user_id" "uuid" NOT NULL,
    "reading_theme" "text" DEFAULT 'paper'::"text" NOT NULL,
    "text_size" "text" DEFAULT 'comfortable'::"text" NOT NULL,
    "reading_width" "text" DEFAULT 'standard'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reader_preferences_reading_theme_check" CHECK (("reading_theme" = ANY (ARRAY['paper'::"text", 'sepia'::"text", 'night'::"text"]))),
    CONSTRAINT "reader_preferences_reading_width_check" CHECK (("reading_width" = ANY (ARRAY['narrow'::"text", 'standard'::"text", 'wide'::"text"]))),
    CONSTRAINT "reader_preferences_text_size_check" CHECK (("text_size" = ANY (ARRAY['small'::"text", 'comfortable'::"text", 'large'::"text"])))
);


ALTER TABLE "public"."reader_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reader_reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "reaction_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reader_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reading_progress" (
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "progress_percent" numeric(5,2) DEFAULT 0 NOT NULL,
    "last_position" "jsonb",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reading_progress_range" CHECK ((("progress_percent" >= (0)::numeric) AND ("progress_percent" <= (100)::numeric)))
);


ALTER TABLE "public"."reading_progress" OWNER TO "postgres";


COMMENT ON TABLE "public"."reading_progress" IS 'Reader progress, position and completion state for each episode.';



CREATE TABLE IF NOT EXISTS "public"."review_helpful_votes" (
    "user_id" "uuid" NOT NULL,
    "review_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."review_helpful_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "episode_id" "uuid" NOT NULL,
    "headline" "text",
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "visibility" "text" DEFAULT 'public'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_status_valid" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'hidden'::"text", 'deleted'::"text"]))),
    CONSTRAINT "review_visibility_valid" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "story_id" "uuid" NOT NULL,
    "season_number" integer NOT NULL,
    "title" "text",
    "synopsis" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "season_number_positive" CHECK (("season_number" > 0))
);


ALTER TABLE "public"."seasons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "tagline" "text",
    "synopsis" "text",
    "cover_path" "text",
    "publication_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "first_episode_free" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completion_status" "text" DEFAULT 'ongoing'::"text" NOT NULL,
    CONSTRAINT "stories_completion_status_check" CHECK (("completion_status" = ANY (ARRAY['ongoing'::"text", 'completed'::"text"]))),
    CONSTRAINT "story_slug_format" CHECK (("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::"text")),
    CONSTRAINT "story_status_valid" CHECK (("publication_status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"]))),
    CONSTRAINT "story_title_not_empty" CHECK (("length"(TRIM(BOTH FROM "title")) > 0))
);


ALTER TABLE "public"."stories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_collections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "collection_type" "text" DEFAULT 'series'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "collection_title_not_empty" CHECK (("length"(TRIM(BOTH FROM "title")) > 0)),
    CONSTRAINT "collection_type_valid" CHECK (("collection_type" = ANY (ARRAY['series'::"text", 'collection'::"text"])))
);


ALTER TABLE "public"."story_collections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_creators" (
    "story_id" "uuid" NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'author'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "story_creator_role_valid" CHECK (("role" = ANY (ARRAY['owner'::"text", 'author'::"text", 'editor'::"text", 'contributor'::"text"])))
);


ALTER TABLE "public"."story_creators" OWNER TO "postgres";


ALTER TABLE ONLY "public"."author_notes"
    ADD CONSTRAINT "author_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."author_replies"
    ADD CONSTRAINT "author_replies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."author_replies"
    ADD CONSTRAINT "author_replies_review_id_creator_id_key" UNIQUE ("review_id", "creator_id");



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("user_id", "story_id");



ALTER TABLE ONLY "public"."collection_items"
    ADD CONSTRAINT "collection_items_collection_id_position_key" UNIQUE ("collection_id", "position");



ALTER TABLE ONLY "public"."collection_items"
    ADD CONSTRAINT "collection_items_pkey" PRIMARY KEY ("collection_id", "story_id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."creator_profiles"
    ADD CONSTRAINT "creator_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_assets"
    ADD CONSTRAINT "episode_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_assets"
    ADD CONSTRAINT "episode_assets_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."episode_entitlements"
    ADD CONSTRAINT "episode_entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_entitlements"
    ADD CONSTRAINT "episode_entitlements_user_id_episode_id_key" UNIQUE ("user_id", "episode_id");



ALTER TABLE ONLY "public"."episode_participations"
    ADD CONSTRAINT "episode_participations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_participations"
    ADD CONSTRAINT "episode_participations_user_id_episode_id_key" UNIQUE ("user_id", "episode_id");



ALTER TABLE ONLY "public"."episode_publication_queue"
    ADD CONSTRAINT "episode_publication_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_revisions"
    ADD CONSTRAINT "episode_revisions_episode_id_revision_number_key" UNIQUE ("episode_id", "revision_number");



ALTER TABLE ONLY "public"."episode_revisions"
    ADD CONSTRAINT "episode_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_unlock_events"
    ADD CONSTRAINT "episode_unlock_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_unlock_events"
    ADD CONSTRAINT "episode_unlock_events_user_id_source_episode_id_unlocked_ep_key" UNIQUE ("user_id", "source_episode_id", "unlocked_episode_id");



ALTER TABLE ONLY "public"."episode_unlock_events"
    ADD CONSTRAINT "episode_unlock_events_user_id_unlocked_episode_id_key" UNIQUE ("user_id", "unlocked_episode_id");



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_story_id_sequence_number_key" UNIQUE ("story_id", "sequence_number");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."publication_history"
    ADD CONSTRAINT "publication_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reaction_definitions"
    ADD CONSTRAINT "reaction_definitions_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."reaction_definitions"
    ADD CONSTRAINT "reaction_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reader_preferences"
    ADD CONSTRAINT "reader_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."reader_reactions"
    ADD CONSTRAINT "reader_reactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reader_reactions"
    ADD CONSTRAINT "reader_reactions_user_id_episode_id_reaction_id_key" UNIQUE ("user_id", "episode_id", "reaction_id");



ALTER TABLE ONLY "public"."reading_progress"
    ADD CONSTRAINT "reading_progress_pkey" PRIMARY KEY ("user_id", "episode_id");



ALTER TABLE ONLY "public"."review_helpful_votes"
    ADD CONSTRAINT "review_helpful_votes_pkey" PRIMARY KEY ("user_id", "review_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_episode_id_key" UNIQUE ("user_id", "episode_id");



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_id_story_id_key" UNIQUE ("id", "story_id");



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_story_id_season_number_key" UNIQUE ("story_id", "season_number");



ALTER TABLE ONLY "public"."stories"
    ADD CONSTRAINT "stories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stories"
    ADD CONSTRAINT "stories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."story_collections"
    ADD CONSTRAINT "story_collections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."story_creators"
    ADD CONSTRAINT "story_creators_pkey" PRIMARY KEY ("story_id", "creator_id");



CREATE INDEX "author_notes_episode_idx" ON "public"."author_notes" USING "btree" ("episode_id") WHERE ("episode_id" IS NOT NULL);



CREATE INDEX "author_notes_story_idx" ON "public"."author_notes" USING "btree" ("story_id", "status", "published_at" DESC);



CREATE INDEX "author_replies_review_idx" ON "public"."author_replies" USING "btree" ("review_id", "created_at");



CREATE INDEX "bookmarks_story_idx" ON "public"."bookmarks" USING "btree" ("story_id");



CREATE INDEX "collection_items_story_idx" ON "public"."collection_items" USING "btree" ("story_id");



CREATE INDEX "content_reports_status_idx" ON "public"."content_reports" USING "btree" ("status", "created_at");



CREATE INDEX "episode_assets_episode_idx" ON "public"."episode_assets" USING "btree" ("episode_id", "position");



CREATE INDEX "episode_entitlements_episode_idx" ON "public"."episode_entitlements" USING "btree" ("episode_id");



CREATE INDEX "episode_entitlements_source_idx" ON "public"."episode_entitlements" USING "btree" ("source_episode_id");



CREATE INDEX "episode_entitlements_user_idx" ON "public"."episode_entitlements" USING "btree" ("user_id");



CREATE INDEX "episode_participations_episode_idx" ON "public"."episode_participations" USING "btree" ("episode_id");



CREATE INDEX "episode_publication_queue_due_idx" ON "public"."episode_publication_queue" USING "btree" ("scheduled_at") WHERE ("status" = 'scheduled'::"text");



CREATE UNIQUE INDEX "episode_publication_queue_one_scheduled_per_episode" ON "public"."episode_publication_queue" USING "btree" ("episode_id") WHERE ("status" = 'scheduled'::"text");



CREATE INDEX "episode_revisions_episode_idx" ON "public"."episode_revisions" USING "btree" ("episode_id", "revision_number" DESC);



CREATE INDEX "episode_unlock_events_user_idx" ON "public"."episode_unlock_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "episodes_publication_status_idx" ON "public"."episodes" USING "btree" ("publication_status");



CREATE INDEX "episodes_season_idx" ON "public"."episodes" USING "btree" ("season_id");



CREATE INDEX "episodes_story_sequence_idx" ON "public"."episodes" USING "btree" ("story_id", "sequence_number");



CREATE UNIQUE INDEX "notifications_user_event_key_unique" ON "public"."notifications" USING "btree" ("user_id", "event_key") WHERE ("event_key" IS NOT NULL);



CREATE INDEX "notifications_user_history_idx" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "notifications_user_unread_idx" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "publication_history_episode_idx" ON "public"."publication_history" USING "btree" ("episode_id", "created_at" DESC) WHERE ("episode_id" IS NOT NULL);



CREATE INDEX "publication_history_story_idx" ON "public"."publication_history" USING "btree" ("story_id", "created_at" DESC);



CREATE INDEX "reader_reactions_episode_idx" ON "public"."reader_reactions" USING "btree" ("episode_id", "reaction_id");



CREATE INDEX "reader_reactions_user_idx" ON "public"."reader_reactions" USING "btree" ("user_id", "episode_id");



CREATE INDEX "reading_progress_episode_idx" ON "public"."reading_progress" USING "btree" ("episode_id");



CREATE INDEX "reading_progress_user_updated_idx" ON "public"."reading_progress" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "review_helpful_votes_review_idx" ON "public"."review_helpful_votes" USING "btree" ("review_id");



CREATE INDEX "reviews_public_episode_idx" ON "public"."reviews" USING "btree" ("episode_id", "submitted_at" DESC) WHERE (("visibility" = 'public'::"text") AND ("status" = 'submitted'::"text"));



CREATE INDEX "reviews_user_idx" ON "public"."reviews" USING "btree" ("user_id", "episode_id");



CREATE INDEX "stories_creator_idx" ON "public"."stories" USING "btree" ("created_by");



CREATE INDEX "stories_status_idx" ON "public"."stories" USING "btree" ("publication_status");



CREATE INDEX "story_creators_creator_idx" ON "public"."story_creators" USING "btree" ("creator_id");



CREATE OR REPLACE TRIGGER "author_note_published_notification" AFTER INSERT OR UPDATE OF "status" ON "public"."author_notes" FOR EACH ROW EXECUTE FUNCTION "public"."notify_author_note_published"();



CREATE OR REPLACE TRIGGER "author_notes_updated_at" BEFORE UPDATE ON "public"."author_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "author_replies_updated_at" BEFORE UPDATE ON "public"."author_replies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "author_reply_published_notification" AFTER INSERT OR UPDATE OF "status" ON "public"."author_replies" FOR EACH ROW EXECUTE FUNCTION "public"."notify_author_reply_published"();



CREATE OR REPLACE TRIGGER "creator_profiles_updated_at" BEFORE UPDATE ON "public"."creator_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "episode_published_notification" AFTER INSERT OR UPDATE OF "publication_status" ON "public"."episodes" FOR EACH ROW EXECUTE FUNCTION "public"."notify_episode_published"();



CREATE OR REPLACE TRIGGER "episode_revision_cancels_stale_schedule" AFTER INSERT ON "public"."episode_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."cancel_episode_schedule_on_revision"();



CREATE OR REPLACE TRIGGER "episodes_updated_at" BEFORE UPDATE ON "public"."episodes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "notification_preferences_updated_at" BEFORE UPDATE ON "public"."notification_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_notification_preferences_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reader_preferences_updated_at" BEFORE UPDATE ON "public"."reader_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reading_progress_updated_at" BEFORE UPDATE ON "public"."reading_progress" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reviews_updated_at" BEFORE UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "seasons_updated_at" BEFORE UPDATE ON "public"."seasons" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "stories_updated_at" BEFORE UPDATE ON "public"."stories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "story_collections_updated_at" BEFORE UPDATE ON "public"."story_collections" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."author_notes"
    ADD CONSTRAINT "author_notes_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."author_notes"
    ADD CONSTRAINT "author_notes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."author_notes"
    ADD CONSTRAINT "author_notes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."author_replies"
    ADD CONSTRAINT "author_replies_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."author_replies"
    ADD CONSTRAINT "author_replies_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collection_items"
    ADD CONSTRAINT "collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "public"."story_collections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collection_items"
    ADD CONSTRAINT "collection_items_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_target_author_note_id_fkey" FOREIGN KEY ("target_author_note_id") REFERENCES "public"."author_notes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_target_author_reply_id_fkey" FOREIGN KEY ("target_author_reply_id") REFERENCES "public"."author_replies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_target_review_id_fkey" FOREIGN KEY ("target_review_id") REFERENCES "public"."reviews"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."creator_profiles"
    ADD CONSTRAINT "creator_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_assets"
    ADD CONSTRAINT "episode_assets_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_entitlements"
    ADD CONSTRAINT "episode_entitlements_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_entitlements"
    ADD CONSTRAINT "episode_entitlements_source_episode_id_fkey" FOREIGN KEY ("source_episode_id") REFERENCES "public"."episodes"("id");



ALTER TABLE ONLY "public"."episode_entitlements"
    ADD CONSTRAINT "episode_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_participations"
    ADD CONSTRAINT "episode_participations_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_participations"
    ADD CONSTRAINT "episode_participations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_publication_queue"
    ADD CONSTRAINT "episode_publication_queue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."episode_publication_queue"
    ADD CONSTRAINT "episode_publication_queue_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_publication_queue"
    ADD CONSTRAINT "episode_publication_queue_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."episode_revisions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_revisions"
    ADD CONSTRAINT "episode_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."episode_revisions"
    ADD CONSTRAINT "episode_revisions_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episode_season_same_story" FOREIGN KEY ("season_id", "story_id") REFERENCES "public"."seasons"("id", "story_id");



ALTER TABLE ONLY "public"."episode_unlock_events"
    ADD CONSTRAINT "episode_unlock_events_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "public"."episode_participations"("id");



ALTER TABLE ONLY "public"."episode_unlock_events"
    ADD CONSTRAINT "episode_unlock_events_source_episode_id_fkey" FOREIGN KEY ("source_episode_id") REFERENCES "public"."episodes"("id");



ALTER TABLE ONLY "public"."episode_unlock_events"
    ADD CONSTRAINT "episode_unlock_events_unlocked_episode_id_fkey" FOREIGN KEY ("unlocked_episode_id") REFERENCES "public"."episodes"("id");



ALTER TABLE ONLY "public"."episode_unlock_events"
    ADD CONSTRAINT "episode_unlock_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."publication_history"
    ADD CONSTRAINT "publication_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publication_history"
    ADD CONSTRAINT "publication_history_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publication_history"
    ADD CONSTRAINT "publication_history_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reader_preferences"
    ADD CONSTRAINT "reader_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reader_reactions"
    ADD CONSTRAINT "reader_reactions_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reader_reactions"
    ADD CONSTRAINT "reader_reactions_reaction_id_fkey" FOREIGN KEY ("reaction_id") REFERENCES "public"."reaction_definitions"("id");



ALTER TABLE ONLY "public"."reader_reactions"
    ADD CONSTRAINT "reader_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reading_progress"
    ADD CONSTRAINT "reading_progress_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reading_progress"
    ADD CONSTRAINT "reading_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_helpful_votes"
    ADD CONSTRAINT "review_helpful_votes_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_helpful_votes"
    ADD CONSTRAINT "review_helpful_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stories"
    ADD CONSTRAINT "stories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."story_collections"
    ADD CONSTRAINT "story_collections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."story_creators"
    ADD CONSTRAINT "story_creators_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profiles"("id");



ALTER TABLE ONLY "public"."story_creators"
    ADD CONSTRAINT "story_creators_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;



ALTER TABLE "public"."author_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."author_replies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookmarks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."collection_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."creator_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_participations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_publication_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_unlock_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."publication_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reaction_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reader_reactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reading_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_helpful_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."story_collections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."story_creators" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."assert_episode_access"("p_user_id" "uuid", "p_episode_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_episode_access"("p_user_id" "uuid", "p_episode_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bookmark_story"("p_story_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bookmark_story"("p_story_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."bookmark_story"("p_story_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_episode_schedule_on_revision"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_episode_schedule_on_revision"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_creator_author_notes"("p_story_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_creator_author_notes"("p_story_id" "uuid", "p_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_creator_author_notes"("p_story_id" "uuid", "p_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_creator_moderation_queue"("p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_creator_moderation_queue"("p_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_creator_moderation_queue"("p_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_creator_story_workspace"("p_story_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_creator_story_workspace"("p_story_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_creator_story_workspace"("p_story_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_notification_preferences"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_notification_preferences"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_my_notification_preferences"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_notifications"("p_limit" integer, "p_unread_only" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_notifications"("p_limit" integer, "p_unread_only" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_my_notifications"("p_limit" integer, "p_unread_only" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."grant_next_episode"("p_user_id" "uuid", "p_source_episode_id" "uuid", "p_participation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_next_episode"("p_user_id" "uuid", "p_source_episode_id" "uuid", "p_participation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_all_notifications_read"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."moderate_content_report"("p_report_id" "uuid", "p_decision" "text", "p_hide_content" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."moderate_content_report"("p_report_id" "uuid", "p_decision" "text", "p_hide_content" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."moderate_content_report"("p_report_id" "uuid", "p_decision" "text", "p_hide_content" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."notify_author_note_published"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_author_note_published"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_author_reply_published"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_author_reply_published"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_episode_published"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_episode_published"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_author_reply"("p_review_id" "uuid", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_author_reply"("p_review_id" "uuid", "p_body" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_author_reply"("p_review_id" "uuid", "p_body" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_creator_episode"("p_episode_id" "uuid", "p_revision_id" "uuid", "p_action" "text", "p_scheduled_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_creator_episode"("p_episode_id" "uuid", "p_revision_id" "uuid", "p_action" "text", "p_scheduled_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_creator_episode"("p_episode_id" "uuid", "p_revision_id" "uuid", "p_action" "text", "p_scheduled_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_creator_story"("p_story_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_creator_story"("p_story_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_creator_story"("p_story_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_due_author_notes"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_due_author_notes"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_due_episodes"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_due_episodes"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_creator_episode_image"("p_episode_id" "uuid", "p_storage_path" "text", "p_alt_text" "text", "p_position" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_creator_episode_image"("p_episode_id" "uuid", "p_storage_path" "text", "p_alt_text" "text", "p_position" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."register_creator_episode_image"("p_episode_id" "uuid", "p_storage_path" "text", "p_alt_text" "text", "p_position" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."remove_review_helpful_vote"("p_review_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_review_helpful_vote"("p_review_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."remove_review_helpful_vote"("p_review_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."remove_story_bookmark"("p_story_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_story_bookmark"("p_story_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."remove_story_bookmark"("p_story_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_content"("p_target_type" "text", "p_target_id" "uuid", "p_reason" "text", "p_details" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_content"("p_target_type" "text", "p_target_id" "uuid", "p_reason" "text", "p_details" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."report_content"("p_target_type" "text", "p_target_id" "uuid", "p_reason" "text", "p_details" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_author_note"("p_story_id" "uuid", "p_body" "text", "p_action" "text", "p_note_id" "uuid", "p_episode_id" "uuid", "p_title" "text", "p_scheduled_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_author_note"("p_story_id" "uuid", "p_body" "text", "p_action" "text", "p_note_id" "uuid", "p_episode_id" "uuid", "p_title" "text", "p_scheduled_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."save_author_note"("p_story_id" "uuid", "p_body" "text", "p_action" "text", "p_note_id" "uuid", "p_episode_id" "uuid", "p_title" "text", "p_scheduled_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_creator_episode"("p_episode_id" "uuid", "p_story_id" "uuid", "p_season_id" "uuid", "p_sequence_number" integer, "p_title" "text", "p_synopsis" "text", "p_content" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_creator_episode"("p_episode_id" "uuid", "p_story_id" "uuid", "p_season_id" "uuid", "p_sequence_number" integer, "p_title" "text", "p_synopsis" "text", "p_content" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_creator_episode"("p_episode_id" "uuid", "p_story_id" "uuid", "p_season_id" "uuid", "p_sequence_number" integer, "p_title" "text", "p_synopsis" "text", "p_content" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_creator_story"("p_story_id" "uuid", "p_title" "text", "p_slug" "text", "p_tagline" "text", "p_synopsis" "text", "p_first_episode_free" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_creator_story"("p_story_id" "uuid", "p_title" "text", "p_slug" "text", "p_tagline" "text", "p_synopsis" "text", "p_first_episode_free" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."save_creator_story"("p_story_id" "uuid", "p_title" "text", "p_slug" "text", "p_tagline" "text", "p_synopsis" "text", "p_first_episode_free" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_my_notification_preferences"("p_new_episodes" boolean, "p_author_replies" boolean, "p_author_notes" boolean, "p_saved_story_updates" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_my_notification_preferences"("p_new_episodes" boolean, "p_author_replies" boolean, "p_author_notes" boolean, "p_saved_story_updates" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."save_my_notification_preferences"("p_new_episodes" boolean, "p_author_replies" boolean, "p_author_notes" boolean, "p_saved_story_updates" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_reader_preferences"("p_theme" "text", "p_text_size" "text", "p_reading_width" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_reader_preferences"("p_theme" "text", "p_text_size" "text", "p_reading_width" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_reader_preferences"("p_theme" "text", "p_text_size" "text", "p_reading_width" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_reading_progress"("p_episode_id" "uuid", "p_progress_percent" numeric, "p_last_position" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_reading_progress"("p_episode_id" "uuid", "p_progress_percent" numeric, "p_last_position" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_reading_progress"("p_episode_id" "uuid", "p_progress_percent" numeric, "p_last_position" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_author_note_pinned"("p_note_id" "uuid", "p_is_pinned" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_author_note_pinned"("p_note_id" "uuid", "p_is_pinned" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_author_note_pinned"("p_note_id" "uuid", "p_is_pinned" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_creator_story_completion_status"("p_story_id" "uuid", "p_completion_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_creator_story_completion_status"("p_story_id" "uuid", "p_completion_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_creator_story_completion_status"("p_story_id" "uuid", "p_completion_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_creator_story_cover"("p_story_id" "uuid", "p_storage_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_creator_story_cover"("p_story_id" "uuid", "p_storage_path" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_creator_story_cover"("p_story_id" "uuid", "p_storage_path" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_notification_preferences_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_episode_reactions"("p_episode_id" "uuid", "p_reaction_codes" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_episode_reactions"("p_episode_id" "uuid", "p_reaction_codes" "text"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."submit_episode_reactions"("p_episode_id" "uuid", "p_reaction_codes" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."submit_episode_review"("p_episode_id" "uuid", "p_headline" "text", "p_body" "text", "p_visibility" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_episode_review"("p_episode_id" "uuid", "p_headline" "text", "p_body" "text", "p_visibility" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."submit_episode_review"("p_episode_id" "uuid", "p_headline" "text", "p_body" "text", "p_visibility" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."vote_review_helpful"("p_review_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vote_review_helpful"("p_review_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."vote_review_helpful"("p_review_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."author_notes" TO "service_role";



GRANT ALL ON TABLE "public"."author_replies" TO "service_role";



GRANT ALL ON TABLE "public"."bookmarks" TO "service_role";



GRANT ALL ON TABLE "public"."collection_items" TO "service_role";



GRANT ALL ON TABLE "public"."content_reports" TO "service_role";



GRANT ALL ON TABLE "public"."creator_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."episode_assets" TO "service_role";



GRANT ALL ON TABLE "public"."episode_entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."episode_participations" TO "service_role";



GRANT ALL ON TABLE "public"."episode_publication_queue" TO "service_role";



GRANT ALL ON TABLE "public"."episode_revisions" TO "service_role";



GRANT ALL ON TABLE "public"."episode_unlock_events" TO "service_role";



GRANT ALL ON TABLE "public"."episodes" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."publication_history" TO "service_role";



GRANT ALL ON TABLE "public"."reaction_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."reader_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."reader_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."reading_progress" TO "service_role";



GRANT ALL ON TABLE "public"."review_helpful_votes" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."seasons" TO "service_role";



GRANT ALL ON TABLE "public"."stories" TO "service_role";



GRANT ALL ON TABLE "public"."story_collections" TO "service_role";



GRANT ALL ON TABLE "public"."story_creators" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








-- STORYFLICKS: Supabase-managed setup omitted from public schema dump.

-- Automatically create a profile for every new authenticated user.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- Public artwork bucket for story covers and episode images.
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'story-assets',
    'story-assets',
    true,
    10485760,
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/avif'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;


-- Seed the curated Reader Reactions.
INSERT INTO public.reaction_definitions
    (code, statement, emoji, category, sort_order, is_active)
VALUES
    ('absolutely_riveting', 'Absolutely riveting.', '🔥', 'positive', 1, true),
    ('did_not_see_that_coming', 'I did not see that coming.', '🤯', 'surprise', 2, true),
    ('made_me_think', 'Made me think.', '🧠', 'intellectual', 3, true),
    ('emotionally_invested', 'I am emotionally invested.', '❤️', 'emotional', 4, true),
    ('unexpectedly_entertaining', 'Unexpectedly entertaining.', '😂', 'humour', 5, true),
    ('connecting_the_dots', 'I am connecting the dots.', '🕵️', 'curiosity', 6, true),
    ('made_me_uncomfortable', 'That made me uncomfortable.', '😬', 'mixed', 7, true),
    ('did_not_work_for_me', 'It did not work for me.', '👎', 'critical', 8, true)
ON CONFLICT (code) DO NOTHING;

