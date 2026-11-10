-- Reader support is now charged in US dollars. 'eur' stays valid so that
-- contributions created before the switch, and Checkout Sessions still open
-- at the time of the switch, can still be recorded.
DO $$
DECLARE
    existing record;
BEGIN
    -- Drop the old single-currency CHECK whatever its generated name is.
    FOR existing IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.reader_support_contributions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%currency%'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.reader_support_contributions DROP CONSTRAINT %I',
            existing.conname
        );
    END LOOP;
END
$$;

ALTER TABLE public.reader_support_contributions
    ADD CONSTRAINT reader_support_contributions_currency_check
    CHECK (currency IN ('usd', 'eur'));

ALTER TABLE public.reader_support_contributions
    ALTER COLUMN currency SET DEFAULT 'usd';
