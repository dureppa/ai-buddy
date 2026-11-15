-- Rollback is allowed only after access drafts have been retained elsewhere or removed explicitly.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM service_action_drafts WHERE service='access') THEN
        RAISE EXCEPTION 'access drafts exist; retain them before rolling back';
    END IF;
END $$;
ALTER TABLE service_action_drafts DROP CONSTRAINT service_action_drafts_service_check;
ALTER TABLE service_action_drafts ADD CONSTRAINT service_action_drafts_service_check
    CHECK (service IN ('hiring','offboarding','benefits','jira'));
