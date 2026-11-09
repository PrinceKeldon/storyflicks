CREATE TABLE IF NOT EXISTS public.story_material_sections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 section_type text NOT NULL DEFAULT 'other' CHECK(section_type IN ('dedication','foreword','preface','author_note','prologue','epilogue','afterword','acknowledgements','about_author','further_reading','other')),
 placement text NOT NULL CHECK(placement IN ('front_matter','back_matter')),
 position integer NOT NULL DEFAULT 0 CHECK(position >= 0),
 content jsonb NOT NULL DEFAULT '[]'::jsonb,
 publication_status text NOT NULL DEFAULT 'draft' CHECK(publication_status IN ('draft','published')),
 is_visible boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS story_material_sections_reader_idx ON public.story_material_sections(story_id,placement,position) WHERE publication_status='published' AND is_visible=true;
CREATE INDEX IF NOT EXISTS story_material_sections_creator_idx ON public.story_material_sections(story_id,placement,position);
ALTER TABLE public.story_material_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read published story materials" ON public.story_material_sections;
CREATE POLICY "Public can read published story materials" ON public.story_material_sections FOR SELECT TO anon,authenticated USING(publication_status='published' AND is_visible=true AND EXISTS(SELECT 1 FROM public.stories s WHERE s.id=story_material_sections.story_id AND s.publication_status='published'));
DROP POLICY IF EXISTS "Creators can manage assigned story materials" ON public.story_material_sections;
CREATE POLICY "Creators can manage assigned story materials" ON public.story_material_sections FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM public.story_creators sc JOIN public.creator_profiles cp ON cp.id=sc.creator_id WHERE sc.story_id=story_material_sections.story_id AND sc.creator_id=auth.uid() AND sc.role IN ('owner','author','editor') AND cp.status='active')) WITH CHECK(EXISTS(SELECT 1 FROM public.story_creators sc JOIN public.creator_profiles cp ON cp.id=sc.creator_id WHERE sc.story_id=story_material_sections.story_id AND sc.creator_id=auth.uid() AND sc.role IN ('owner','author','editor') AND cp.status='active'));
GRANT SELECT ON public.story_material_sections TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.story_material_sections TO authenticated;
COMMENT ON TABLE public.story_material_sections IS 'Front matter and back matter independent of numbered episodes or chapters.';
