-- Keep the live publication-history event vocabulary aligned with
-- save_creator_episode(), which records each saved creator revision.
alter table public.publication_history
    drop constraint if exists publication_history_event_type_check;

alter table public.publication_history
    add constraint publication_history_event_type_check
    check (
        event_type = any (
            array[
                'story_created',
                'story_updated',
                'story_published',
                'story_archived',
                'episode_created',
                'episode_published',
                'episode_scheduled',
                'episode_withdrawn',
                'episode_revised',
                'episode_reordered',
                'episode_draft_saved'
            ]::text[]
        )
    );
