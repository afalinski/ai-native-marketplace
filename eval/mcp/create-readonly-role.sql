-- Run once in each database (catalogdb, orderingdb) as a superuser:
--   psql -d catalogdb  -v mcp_password=... -f create-readonly-role.sql
--   psql -d orderingdb -v mcp_password=... -f create-readonly-role.sql
-- Idempotent. Grants SELECT only. The schema is chosen from the database name.
SELECT set_config('mcp.pw', :'mcp_password', false);

DO $$
DECLARE
    app_schema text := CASE current_database() WHEN 'catalogdb' THEN 'public' ELSE 'ordering' END;
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mcp_readonly') THEN
        EXECUTE format('CREATE ROLE mcp_readonly LOGIN PASSWORD %L', current_setting('mcp.pw'));
    ELSE
        EXECUTE format('ALTER ROLE mcp_readonly LOGIN PASSWORD %L', current_setting('mcp.pw'));
    END IF;

    EXECUTE format('GRANT CONNECT ON DATABASE %I TO mcp_readonly', current_database());
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO mcp_readonly', app_schema);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO mcp_readonly', app_schema);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO mcp_readonly', app_schema);
END
$$;
