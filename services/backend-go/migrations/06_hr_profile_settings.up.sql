CREATE TABLE IF NOT EXISTS hr_profile_settings (
    profile_id text PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    vacation_days integer NOT NULL CHECK (vacation_days >= 0),
    vacation_notice_days integer NOT NULL CHECK (vacation_notice_days >= 0),
    travel_enabled boolean NOT NULL,
    travel_budget integer NOT NULL CHECK (travel_budget >= 0),
    referral_slots integer NOT NULL CHECK (referral_slots >= 0),
    exit_notice_days integer NOT NULL CHECK (exit_notice_days >= 0),
    exit_checklist text[] NOT NULL CHECK (exit_checklist <@ ARRAY['handover', 'equipment', 'feedback']),
    consents text[] NOT NULL CHECK (consents <@ ARRAY['news', 'photos']),
    benefit_budget integer NOT NULL CHECK (benefit_budget >= 0),
    benefits text[] NOT NULL CHECK (benefits <@ ARRAY['learning', 'sport', 'wellbeing'])
);
