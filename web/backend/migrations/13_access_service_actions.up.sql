ALTER TABLE service_action_drafts DROP CONSTRAINT service_action_drafts_service_check;
ALTER TABLE service_action_drafts ADD CONSTRAINT service_action_drafts_service_check
    CHECK (service IN ('hiring','offboarding','benefits','jira','access'));
