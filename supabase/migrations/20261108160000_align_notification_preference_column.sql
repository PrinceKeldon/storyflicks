-- Align the live notification preference column with the RPCs and notification delivery logic.
-- RENAME preserves all existing user preference values.
ALTER TABLE public.notification_preferences
    RENAME COLUMN story_updates TO saved_story_updates;
