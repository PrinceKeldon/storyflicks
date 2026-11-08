ALTER TABLE public.stories
  ADD CONSTRAINT stories_title_length_check
    CHECK (length(trim(title)) BETWEEN 1 AND 160),
  ADD CONSTRAINT stories_slug_length_check
    CHECK (length(slug) BETWEEN 1 AND 100),
  ADD CONSTRAINT stories_tagline_length_check
    CHECK (tagline IS NULL OR length(tagline) <= 240),
  ADD CONSTRAINT stories_synopsis_length_check
    CHECK (synopsis IS NULL OR length(synopsis) <= 10000);

ALTER TABLE public.episodes
  ADD CONSTRAINT episodes_title_length_check
    CHECK (length(trim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT episodes_synopsis_length_check
    CHECK (synopsis IS NULL OR length(synopsis) <= 10000),
  ADD CONSTRAINT episodes_content_size_check
    CHECK (octet_length(content::text) <= 2097152);

ALTER TABLE public.episode_revisions
  ADD CONSTRAINT episode_revisions_title_length_check
    CHECK (length(trim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT episode_revisions_synopsis_length_check
    CHECK (synopsis IS NULL OR length(synopsis) <= 10000),
  ADD CONSTRAINT episode_revisions_content_size_check
    CHECK (octet_length(content::text) <= 2097152);

ALTER TABLE public.author_notes
  ADD CONSTRAINT author_notes_title_length_check
    CHECK (title IS NULL OR length(title) <= 200),
  ADD CONSTRAINT author_notes_body_length_check
    CHECK (length(body) BETWEEN 1 AND 50000);

ALTER TABLE public.author_replies
  ADD CONSTRAINT author_replies_body_length_check
    CHECK (length(body) BETWEEN 1 AND 10000);

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_headline_length_check
    CHECK (headline IS NULL OR length(headline) <= 300),
  ADD CONSTRAINT reviews_body_length_check
    CHECK (length(body) BETWEEN 1 AND 20000);

ALTER TABLE public.reading_progress
  ADD CONSTRAINT reading_progress_last_position_size_check
    CHECK (
      last_position IS NULL
      OR octet_length(last_position::text) <= 8192
    );

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_details_length_check
    CHECK (details IS NULL OR length(details) <= 2000);
