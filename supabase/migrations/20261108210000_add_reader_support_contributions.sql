-- STORYFLICKS voluntary reader support. No reading entitlement is created by a contribution.
CREATE TABLE IF NOT EXISTS public.reader_support_contributions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE RESTRICT,
    stripe_checkout_session_id text NOT NULL UNIQUE,
    stripe_payment_intent_id text,
    amount_cents integer NOT NULL CHECK (amount_cents >= 200 AND amount_cents <= 50000),
    currency text NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    paid_at timestamptz,
    CONSTRAINT reader_support_payment_intent_unique UNIQUE (stripe_payment_intent_id)
);
CREATE INDEX IF NOT EXISTS reader_support_contributions_story_paid_idx
    ON public.reader_support_contributions (story_id, paid_at DESC)
    WHERE status = 'paid';
ALTER TABLE public.reader_support_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reader_support_contributions FROM anon, authenticated;
GRANT ALL ON public.reader_support_contributions TO service_role;
COMMENT ON TABLE public.reader_support_contributions IS
    'Optional one-time reader support payments. Contributions do not unlock or gate any reading content.';
