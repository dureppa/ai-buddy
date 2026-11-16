-- Existing calendar drafts must be removed before removing support for their service.
DELETE FROM service_action_drafts WHERE service='calendar';
ALTER TABLE service_action_drafts DROP CONSTRAINT service_action_drafts_service_check;
ALTER TABLE service_action_drafts ADD CONSTRAINT service_action_drafts_service_check
    CHECK (service IN ('hiring','offboarding','benefits','jira','access'));
DROP TABLE calendar_events;
DROP TABLE calendar_state;
