INSERT INTO hr_profile_settings (
    profile_id, vacation_days, vacation_notice_days, travel_enabled, travel_budget, referral_slots,
    exit_notice_days, exit_checklist, consents, benefit_budget, benefits
)
SELECT
    profile_id, "vacationDays", "vacationNoticeDays", "travelEnabled", "travelBudget", "referralSlots",
    "exitNoticeDays", "exitChecklist", consents, "benefitBudget", benefits
FROM jsonb_each(:'hr_profiles'::jsonb) AS fixture(profile_id, settings)
CROSS JOIN LATERAL jsonb_to_record(settings) AS fields(
    "vacationDays" integer, "vacationNoticeDays" integer, "travelEnabled" boolean, "travelBudget" integer,
    "referralSlots" integer, "exitNoticeDays" integer, "exitChecklist" text[], consents text[],
    "benefitBudget" integer, benefits text[]
)
ON CONFLICT (profile_id) DO NOTHING;
