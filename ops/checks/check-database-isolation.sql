DO $$
DECLARE
    identity record;
    target record;
    checked integer := 0;
BEGIN
    FOR identity IN
        SELECT rolname, CASE WHEN rolname = 'buddy_confluence'
            THEN 'buddy_tool_confluence' ELSE rolname END AS database_name
        FROM pg_roles
        WHERE rolname ~ '^hr_(absences|trips|hiring|offboarding|consents|benefits|documents|events)$'
           OR rolname ~ '^buddy_tool_'
           OR rolname IN ('buddy_access','buddy_confluence')
    LOOP
        IF NOT has_database_privilege(identity.rolname, identity.database_name, 'CONNECT') THEN
            RAISE EXCEPTION '% cannot connect to %', identity.rolname, identity.database_name;
        END IF;
        FOR target IN
            SELECT datname FROM pg_database
            WHERE datname <> identity.database_name
              AND (datname = current_database() OR datname ~ '^(hr_|buddy_)')
        LOOP
            IF has_database_privilege(identity.rolname, target.datname, 'CONNECT') THEN
                RAISE EXCEPTION '% can connect to another application database %',
                    identity.rolname, target.datname;
            END IF;
        END LOOP;
        checked := checked + 1;
    END LOOP;
    IF checked <> 23 THEN
        RAISE EXCEPTION 'expected 23 roles in the shared instance, checked %', checked;
    END IF;
END $$;
