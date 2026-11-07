ALTER TABLE public.publication_history
DROP CONSTRAINT publication_history_event_type_check;

ALTER TABLE public.publication_history
ADD CONSTRAINT publication_history_event_type_check
CHECK (
    event_type = ANY (
        ARRAY[
            'story_created'::text,
            'story_updated'::text,
            'story_published'::text,
            'story_archived'::text,
            'episode_created'::text,
            'episode_published'::text,
            'episode_scheduled'::text,
            'episode_withdrawn'::text,
            'episode_revised'::text,
            'episode_reordered'::text
        ]
    )
);
