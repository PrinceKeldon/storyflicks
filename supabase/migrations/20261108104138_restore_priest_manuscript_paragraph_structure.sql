-- Restore paragraph, dialogue, emphasis and scene-break blocks for the two published THE PRIEST episodes.
-- The manuscript text itself is retained from the imported episode content; only block boundaries/types change.
DO $migration$
DECLARE
    v_episode record;
    v_markers jsonb;
    v_text text;
    v_new_blocks jsonb;
    v_cursor integer;
    v_marker text;
    v_type text;
    v_position integer;
    v_previous_start integer;
    v_previous_type text;
    v_segment text;
BEGIN
    FOR v_episode IN
        SELECT id, content
        FROM public.episodes
        WHERE id IN (
            '9e499223-c9d8-4e7a-9fe5-59d8d8b99149'::uuid,
            '71cfd705-34e0-4273-b32e-083b8c5b987f'::uuid
        )
    LOOP
        IF v_episode.id = '9e499223-c9d8-4e7a-9fe5-59d8d8b99149'::uuid THEN
            v_markers := $ep1$[{"type":"paragraph","marker":"My Name is James, I am a priest,"},{"type":"paragraph","marker":"I have just returned to the conf"},{"type":"paragraph","marker":"What the neighbor said. What the"},{"type":"paragraph","marker":"Sometimes I wonder if she has a "},{"type":"paragraph","marker":"One Thursday Mrs. Joan spends al"},{"type":"paragraph","marker":"A violent thunderstorm has rolle"},{"type":"paragraph","marker":"We priests are not encouraged to"},{"type":"paragraph","marker":"Mrs. Joan is always complaining "},{"type":"paragraph","marker":"Sometimes I wonder whether Mrs. "},{"type":"paragraph","marker":"Confession has a funny way of re"},{"type":"paragraph","marker":"After Mrs. Joan is done, I alway"},{"type":"paragraph","marker":"There are seldom strangers anymo"},{"type":"paragraph","marker":"I often wonder why people insist"},{"type":"paragraph","marker":"If not for my vows. The damn vow"},{"type":"paragraph","marker":"Humans fascinate me. Especially "},{"type":"paragraph","marker":"One man comes convinced his marr"},{"type":"emphasis","marker":"Pathetic."},{"type":"paragraph","marker":"That is the danger of hearing co"},{"type":"paragraph","marker":"On this particular Thursday, a s"},{"type":"dialogue","marker":"Father forgive me for I have sin"},{"type":"paragraph","marker":"At first, I did not pay heed, bu"},{"type":"paragraph","marker":"There is a peculiar cruelty buil"},{"type":"paragraph","marker":"I have spent years convincing my"},{"type":"paragraph","marker":"You're only curious, James. You "},{"type":"paragraph","marker":"I... looked at another woman's m"},{"type":"paragraph","marker":"Most people think confession liv"},{"type":"paragraph","marker":"Priests become experts at waitin"},{"type":"paragraph","marker":"I didn't just look...\" Another p"},{"type":"dialogue","marker":"I wanted him to look back.\""},{"type":"paragraph","marker":"I swallow, not because of what s"},{"type":"paragraph","marker":"She pauses, sighs, I can sense t"},{"type":"paragraph","marker":"She says nothing, not immediatel"},{"type":"paragraph","marker":"Confession is a peculiar exchang"},{"type":"paragraph","marker":"he did.\" Her voice is almost ina"},{"type":"paragraph","marker":"He looked back.\" Another silence"},{"type":"paragraph","marker":"I have delivered some version of"},{"type":"emphasis","marker":"Lord..."},{"type":"paragraph","marker":"This is how it begins, isn't it?"},{"type":"dialogue","marker":"I know it sounds foolish\" \""},{"type":"paragraph","marker":"No,\" I hear myself answer before"},{"type":"paragraph","marker":"Go on, my child.\" Another breath"},{"type":"dialogue","marker":"I've never told anyone this befo"},{"type":"paragraph","marker":"It is probably important to ment"},{"type":"paragraph","marker":"I write them as a way of renewin"},{"type":"paragraph","marker":"So, I became a ghostwriter for a"},{"type":"paragraph","marker":"I write for other people, that i"},{"type":"dialogue","marker":"I... uh... I let him to visit my"},{"type":"paragraph","marker":"She confesses with the slightest"},{"type":"emphasis","marker":"Desire."},{"type":"paragraph","marker":"Ten years ago, during my years a"},{"type":"paragraph","marker":"I told my superiors I wanted to "},{"type":"paragraph","marker":"After seven years of celibacy, I"},{"type":"paragraph","marker":"That is the remarkable thing abo"},{"type":"paragraph","marker":"So, I begun granting myself litt"},{"type":"paragraph","marker":"In Brazil I met a woman I can on"},{"type":"emphasis","marker":"She is married."},{"type":"paragraph","marker":"That inconvenient little detail "},{"type":"paragraph","marker":"That is another remarkable quali"},{"type":"paragraph","marker":"For weeks I entertained the fant"},{"type":"paragraph","marker":"It was a beautiful fantasy. And "},{"type":"paragraph","marker":"Then the woman behind the screen"},{"type":"paragraph","marker":"He put his hand on me… I freeze."},{"type":"paragraph","marker":"and pushed me onto the bed.\""},{"type":"paragraph","marker":"Every word reaches into a grave "},{"type":"paragraph","marker":"She cuts her confession short an"},{"type":"paragraph","marker":"No, don't apologize my child,\" I"},{"type":"paragraph","marker":"She doesn't move, instead, she h"},{"type":"paragraph","marker":"Are you still burdened, my child"},{"type":"paragraph","marker":"I have darker sins.\" she says so"},{"type":"paragraph","marker":"It's enough for today, Father. I"},{"type":"paragraph","marker":"I sit there for a moment, starin"},{"type":"scene_break","marker":"Break."},{"type":"paragraph","marker":"There is a narrow door behind th"},{"type":"paragraph","marker":"The first drag settles nothing. "},{"type":"paragraph","marker":"An Uber is already waiting at th"}]$ep1$::jsonb;
        ELSE
            v_markers := $ep2$[{"type":"paragraph","marker":"Like any other priest who has sp"},{"type":"paragraph","marker":"In the name of whichever saint i"},{"type":"paragraph","marker":"I often wonder if God cares near"},{"type":"paragraph","marker":"Strange how we manage to replace"},{"type":"paragraph","marker":"Coffee. Black. No sugar. No swee"},{"type":"paragraph","marker":"After catching up on the Vatican"},{"type":"paragraph","marker":"There, I order my second coffee."},{"type":"emphasis","marker":"I write."},{"type":"paragraph","marker":"Not sermons, or devotional refle"},{"type":"paragraph","marker":"The authors get the interviews, "},{"type":"paragraph","marker":"That businessman tormented by fa"},{"type":"paragraph","marker":"My latest assignment is for a tw"},{"type":"paragraph","marker":"By Thursday afternoon, I am sitt"},{"type":"paragraph","marker":"Anyway, enough of my rumblings o"},{"type":"paragraph","marker":"Same extra spice? Or are you fee"},{"type":"paragraph","marker":"Am I ever not?\" She rolls her ey"},{"type":"dialogue","marker":"One day you'll answer my questio"},{"type":"paragraph","marker":"I just did.\" She laughs."},{"type":"paragraph","marker":"She knows I write. She just does"},{"type":"paragraph","marker":"Fenny has only two ambitions in "},{"type":"paragraph","marker":"She has noticed something that d"},{"type":"dialogue","marker":"There! You did it again.\" She po"},{"type":"dialogue","marker":"It isn't finished.\" I cut in. \""},{"type":"dialogue","marker":"It has never been finished.\" \""},{"type":"paragraph","marker":"It'll be finished when I'm dead."},{"type":"dialogue","marker":"Have you contacted them yet?\" \""},{"type":"paragraph","marker":"No.\" I look her straight in the "},{"type":"paragraph","marker":"They're still learning earthly s"},{"type":"paragraph","marker":"Months ago, she convinced hersel"},{"type":"paragraph","marker":"If you move in with me,\" she add"},{"type":"paragraph","marker":"Including my hot body.\" I never "},{"type":"paragraph","marker":"Fenny, as I fondly refer to her,"},{"type":"paragraph","marker":"I laugh and encourage the banter"},{"type":"paragraph","marker":"You forget your history fast, Ge"},{"type":"paragraph","marker":"I wonder what your aliens think "},{"type":"paragraph","marker":"I spend exactly two hours writin"},{"type":"paragraph","marker":"My chambers are waiting, George."},{"type":"paragraph","marker":"So is my manuscript.\" I shake my"},{"type":"paragraph","marker":"A week passes, routine resets, I"},{"type":"paragraph","marker":"I think I'm ovulating, George..."},{"type":"paragraph","marker":"And I'm overstimulated by your e"},{"type":"paragraph","marker":"I nod toward what I assume is th"},{"type":"paragraph","marker":"Our banter has taken a slightly "},{"type":"paragraph","marker":"I choose this place for several "},{"type":"paragraph","marker":"Second, there is my corner. It s"},{"type":"paragraph","marker":"Whoever designed this café under"},{"type":"paragraph","marker":"And then, there is me. A wayward"},{"type":"paragraph","marker":"I am sitting here, wrapped in my"},{"type":"paragraph","marker":"I pay no attention to my surroun"},{"type":"dialogue","marker":"extra vanilla..., and skimmed mi"},{"type":"emphasis","marker":"My pen stops."},{"type":"paragraph","marker":"It isn't what she says, it is th"},{"type":"paragraph","marker":"I slowly raise my head not wanti"},{"type":"paragraph","marker":"She has the sort of face that re"},{"type":"paragraph","marker":"She carries herself with a quiet"},{"type":"dialogue","marker":"Here you go, ma'am.\""},{"type":"paragraph","marker":"Fenny slides a large takeaway cu"},{"type":"paragraph","marker":"I will break my routine, this on"},{"type":"paragraph","marker":"The aliens want to talk.\u201d She sm"},{"type":"paragraph","marker":"If there\u2019s a breakthrough though"},{"type":"paragraph","marker":"You took too long to come back t"},{"type":"dialogue","marker":"Sounds like a deal.\u201d I respond, "},{"type":"paragraph","marker":"See you at Apt 146... George!\u201d S"},{"type":"paragraph","marker":"The woman I am following has jus"},{"type":"paragraph","marker":"I know, I am a priest who wears "}]$ep2$::jsonb;
        END IF;

        SELECT string_agg(block->>'text', ' ' ORDER BY ordinality)
        INTO v_text
        FROM jsonb_array_elements(v_episode.content->'blocks')
             WITH ORDINALITY AS source_blocks(block, ordinality);

        v_new_blocks := '[]'::jsonb;
        v_cursor := 1;
        v_previous_start := NULL;
        v_previous_type := NULL;

        FOR v_marker, v_type IN
            SELECT marker, type
            FROM jsonb_to_recordset(v_markers)
                 AS marker_rows(marker text, type text)
        LOOP
            v_position := strpos(substr(v_text, v_cursor), v_marker);
            IF v_position = 0 THEN
                RAISE EXCEPTION 'Could not locate manuscript paragraph marker for episode %: %',
                    v_episode.id, v_marker;
            END IF;

            IF v_previous_start IS NOT NULL THEN
                v_segment := btrim(substr(
                    v_text,
                    v_previous_start,
                    (v_cursor + v_position - 1) - v_previous_start
                ));
                IF v_segment <> '' THEN
                    v_new_blocks := v_new_blocks || jsonb_build_array(
                        jsonb_build_object('type', v_previous_type, 'text', v_segment)
                    );
                END IF;
            END IF;

            v_previous_start := v_cursor + v_position - 1;
            v_previous_type := v_type;
            v_cursor := v_previous_start + length(v_marker);
        END LOOP;

        v_segment := btrim(substr(v_text, v_previous_start));
        IF v_segment <> '' THEN
            v_new_blocks := v_new_blocks || jsonb_build_array(
                jsonb_build_object('type', v_previous_type, 'text', v_segment)
            );
        END IF;

        UPDATE public.episodes
        SET content = jsonb_set(content, '{blocks}', v_new_blocks, true),
            updated_at = now()
        WHERE id = v_episode.id;

        UPDATE public.episode_revisions
        SET content = jsonb_set(content, '{blocks}', v_new_blocks, true)
        WHERE episode_id = v_episode.id
          AND revision_status = 'published';
    END LOOP;
END;
$migration$;
