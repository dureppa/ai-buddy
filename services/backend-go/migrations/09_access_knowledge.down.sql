DROP TABLE confluence_pages, portal_access_requests, portal_resources;
-- Keep staff identities and their history when rolling back this feature.
ALTER TABLE profiles DROP COLUMN can_review_access, DROP COLUMN job_role;
