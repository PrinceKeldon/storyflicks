REVOKE ALL
ON FUNCTION public.save_creator_story(uuid, text, text, text, text, boolean)
FROM PUBLIC, anon, authenticated;
