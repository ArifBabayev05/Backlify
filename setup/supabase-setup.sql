-- Create a function to execute SQL statements
CREATE OR REPLACE FUNCTION execute_sql(sql text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    EXECUTE sql;
    -- Refresh the schema cache
    NOTIFY pgrst, 'reload schema';
    RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Create a function to refresh the schema cache
CREATE OR REPLACE FUNCTION refresh_schema_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    NOTIFY pgrst, 'reload schema';
END;
$$;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS deployments;
DROP TABLE IF EXISTS projects;

-- Create projects table with snake_case column names
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schema JSONB,
    endpoints JSONB,
    ai_provider TEXT,
    deployment_id TEXT,
    deployment_url TEXT,
    deployment_status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Create deployments table with snake_case column names
CREATE TABLE IF NOT EXISTS deployments (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    deployment_id TEXT NOT NULL,
    url TEXT,
    status TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_rollback BOOLEAN DEFAULT FALSE,
    rolled_back_from TEXT
);

-- Grant permissions
ALTER FUNCTION execute_sql(text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION execute_sql TO postgres;
GRANT EXECUTE ON FUNCTION execute_sql TO service_role;
GRANT EXECUTE ON FUNCTION execute_sql TO authenticated;
GRANT EXECUTE ON FUNCTION execute_sql TO anon;

ALTER FUNCTION refresh_schema_cache() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION refresh_schema_cache TO postgres;
GRANT EXECUTE ON FUNCTION refresh_schema_cache TO service_role;
GRANT EXECUTE ON FUNCTION refresh_schema_cache TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_schema_cache TO anon;

-- Grant table permissions
GRANT ALL ON TABLE projects TO postgres;
GRANT ALL ON TABLE projects TO service_role;
GRANT ALL ON TABLE projects TO authenticated;
GRANT ALL ON TABLE projects TO anon;

GRANT ALL ON TABLE deployments TO postgres;
GRANT ALL ON TABLE deployments TO service_role;
GRANT ALL ON TABLE deployments TO authenticated;
GRANT ALL ON TABLE deployments TO anon;

-- Grant sequence permissions
GRANT USAGE, SELECT ON SEQUENCE projects_id_seq TO postgres;
GRANT USAGE, SELECT ON SEQUENCE projects_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE projects_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE projects_id_seq TO anon;

GRANT USAGE, SELECT ON SEQUENCE deployments_id_seq TO postgres;
GRANT USAGE, SELECT ON SEQUENCE deployments_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE deployments_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE deployments_id_seq TO anon;

-- Refresh the schema cache
SELECT refresh_schema_cache(); 