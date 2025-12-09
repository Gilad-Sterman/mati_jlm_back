-- Complete Database Setup Script
-- This file creates all tables, indexes, triggers, views, and policies for the Mati JLM application
-- Run this script on a fresh database to set up the complete schema

-- =============================================================================
-- CLEANUP SECTION (if needed)
-- =============================================================================

-- Drop all existing policies if they exist (prevents conflicts)
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Users can view own record" ON users;
DROP POLICY IF EXISTS "Admins can insert users" ON users;
DROP POLICY IF EXISTS "Admins can update all users" ON users;
DROP POLICY IF EXISTS "Users can update own record" ON users;
DROP POLICY IF EXISTS "Admins can delete users" ON users;

DROP POLICY IF EXISTS "Admins can view all clients" ON clients;
DROP POLICY IF EXISTS "Advisers can view own clients" ON clients;
DROP POLICY IF EXISTS "Admins can insert clients" ON clients;
DROP POLICY IF EXISTS "Advisers can insert own clients" ON clients;
DROP POLICY IF EXISTS "Admins can update all clients" ON clients;
DROP POLICY IF EXISTS "Advisers can update own clients" ON clients;
DROP POLICY IF EXISTS "Admins can delete clients" ON clients;

-- =============================================================================
-- UTILITY FUNCTIONS
-- =============================================================================

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================================================
-- USERS TABLE
-- =============================================================================

-- Create users table for advisers and admins
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'adviser' CHECK (role IN ('admin', 'adviser')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes on users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security on users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for users
CREATE POLICY "Users can view own record" ON users
    FOR SELECT USING (auth.uid()::uuid = id);

CREATE POLICY "Users can update own record" ON users
    FOR UPDATE USING (auth.uid()::uuid = id);

-- =============================================================================
-- CLIENTS TABLE
-- =============================================================================

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    adviser_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes on clients table
CREATE INDEX IF NOT EXISTS idx_clients_adviser_id ON clients(adviser_id);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_metadata_gin ON clients USING GIN (metadata);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_clients_updated_at 
    BEFORE UPDATE ON clients 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security on clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for clients
CREATE POLICY "Advisers can view own clients" ON clients
    FOR SELECT USING (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can insert own clients" ON clients
    FOR INSERT WITH CHECK (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can update own clients" ON clients
    FOR UPDATE USING (adviser_id = auth.uid()::uuid);

-- =============================================================================
-- SESSIONS TABLE
-- =============================================================================

-- Create sessions table for meeting recordings
CREATE TABLE IF NOT EXISTS sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    adviser_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    file_url TEXT,
    file_name VARCHAR(255),
    file_size BIGINT,
    file_type VARCHAR(100),
    duration INTEGER, -- in seconds
    status VARCHAR(50) NOT NULL DEFAULT 'uploaded' CHECK (status IN (
        'uploaded', 'processing', 'transcribed', 'advisor_report_generated', 'reports_generated', 'completed', 'failed'
    )),
    transcription_text TEXT,
    transcription_metadata JSONB DEFAULT '{}',
    processing_metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes on sessions table
CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_adviser_id ON sessions(adviser_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_sessions_updated_at 
    BEFORE UPDATE ON sessions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security on sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for sessions
CREATE POLICY "Advisers can view own sessions" ON sessions
    FOR SELECT USING (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can insert own sessions" ON sessions
    FOR INSERT WITH CHECK (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can update own sessions" ON sessions
    FOR UPDATE USING (adviser_id = auth.uid()::uuid);

-- =============================================================================
-- REPORTS TABLE
-- =============================================================================

-- Create reports table with comprehensive versioning support
CREATE TABLE IF NOT EXISTS reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('adviser', 'client')),
    
    -- Version tracking
    version_number INTEGER NOT NULL DEFAULT 1,
    is_current_version BOOLEAN NOT NULL DEFAULT TRUE,
    parent_version_id UUID REFERENCES reports(id), -- For tracking version lineage
    
    -- Content and metadata
    title VARCHAR(255),
    content TEXT NOT NULL,
    content_format VARCHAR(50) DEFAULT 'markdown' CHECK (content_format IN ('markdown', 'html', 'plain')),
    summary TEXT,
    key_points JSONB DEFAULT '[]',
    
    -- Generation and editing tracking
    generation_method VARCHAR(50) NOT NULL CHECK (generation_method IN ('ai_generated', 'manual_edit', 'ai_regenerated')),
    generation_metadata JSONB DEFAULT '{}', -- AI model, prompt version, etc.
    edit_history JSONB DEFAULT '[]', -- Track manual edits
    
    -- Approval workflow
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_review', 'approved', 'rejected', 'archived'
    )),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    approval_notes TEXT,
    
    -- Version comparison data
    word_count INTEGER,
    character_count INTEGER,
    content_hash VARCHAR(64), -- For detecting identical content
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure only one current version per session/type combination
    UNIQUE(session_id, type, version_number)
);

-- Create indexes on reports table
CREATE INDEX IF NOT EXISTS idx_reports_session_id ON reports(session_id);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_current_version ON reports(session_id, type, is_current_version) WHERE is_current_version = TRUE;
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_version_number ON reports(session_id, type, version_number);
CREATE INDEX IF NOT EXISTS idx_reports_parent_version ON reports(parent_version_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_reports_updated_at 
    BEFORE UPDATE ON reports 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Function to ensure only one current version per session/type
CREATE OR REPLACE FUNCTION ensure_single_current_version()
RETURNS TRIGGER AS $$
BEGIN
    -- If this is being set as current version, unset all others for this session/type
    IF NEW.is_current_version = TRUE THEN
        UPDATE reports 
        SET is_current_version = FALSE 
        WHERE session_id = NEW.session_id 
        AND type = NEW.type 
        AND id != NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce single current version
CREATE TRIGGER enforce_single_current_version
    BEFORE INSERT OR UPDATE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_current_version();

-- Enable Row Level Security on reports
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for reports
CREATE POLICY "Advisers can view own session reports" ON reports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM sessions s 
            WHERE s.id = reports.session_id 
            AND s.adviser_id = auth.uid()::uuid
        )
    );

CREATE POLICY "Advisers can insert reports for own sessions" ON reports
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM sessions s 
            WHERE s.id = session_id 
            AND s.adviser_id = auth.uid()::uuid
        )
    );

CREATE POLICY "Advisers can update reports for own sessions" ON reports
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM sessions s 
            WHERE s.id = reports.session_id 
            AND s.adviser_id = auth.uid()::uuid
        )
    );

-- =============================================================================
-- JOBS TABLE
-- =============================================================================

-- Create jobs table for queue system
CREATE TABLE IF NOT EXISTS jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'transcribe', 'generate_reports', 'regenerate_report', 'send_email', 'update_crm'
    )),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'completed', 'failed', 'retry', 'cancelled'
    )),
    priority INTEGER NOT NULL DEFAULT 0, -- Higher number = higher priority
    payload JSONB NOT NULL DEFAULT '{}',
    result JSONB DEFAULT '{}',
    error_log TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes on jobs table
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_order ON jobs(status, priority DESC, scheduled_at ASC) 
    WHERE status IN ('pending', 'retry');

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_jobs_updated_at 
    BEFORE UPDATE ON jobs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Function to get next job from queue
CREATE OR REPLACE FUNCTION get_next_job()
RETURNS TABLE (
    job_id UUID,
    job_type VARCHAR(50),
    session_id UUID,
    payload JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.id,
        j.type,
        j.session_id,
        j.payload
    FROM jobs j
    WHERE j.status IN ('pending', 'retry')
    AND j.scheduled_at <= NOW()
    AND j.attempts < j.max_attempts
    ORDER BY j.priority DESC, j.scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security on jobs
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for jobs
CREATE POLICY "Advisers can view own session jobs" ON jobs
    FOR SELECT USING (
        session_id IS NULL OR -- Allow system jobs with no session
        EXISTS (
            SELECT 1 FROM sessions s 
            WHERE s.id = jobs.session_id 
            AND s.adviser_id = auth.uid()::uuid
        )
    );

-- =============================================================================
-- VIEWS AND HELPER FUNCTIONS
-- =============================================================================

-- Create a view for easy version management and comparison
CREATE OR REPLACE VIEW report_versions_summary AS
SELECT 
    r.session_id,
    r.type,
    r.id as report_id,
    r.version_number,
    r.is_current_version,
    r.parent_version_id,
    r.title,
    r.status,
    r.generation_method,
    r.word_count,
    r.character_count,
    r.created_at as version_created_at,
    r.updated_at as version_updated_at,
    r.approved_by,
    r.approved_at,
    u.name as approved_by_name,
    s.title as session_title,
    c.name as client_name,
    a.name as adviser_name,
    -- Calculate version age
    EXTRACT(EPOCH FROM (NOW() - r.created_at))/3600 as hours_since_created,
    -- Count total versions for this session/type
    (SELECT COUNT(*) FROM reports r2 WHERE r2.session_id = r.session_id AND r2.type = r.type) as total_versions
FROM reports r
LEFT JOIN users u ON r.approved_by = u.id
LEFT JOIN sessions s ON r.session_id = s.id
LEFT JOIN clients c ON s.client_id = c.id
LEFT JOIN users a ON s.adviser_id = a.id
ORDER BY r.session_id, r.type, r.version_number DESC;

-- Create a view for current versions only (most commonly used)
CREATE OR REPLACE VIEW current_reports AS
SELECT 
    r.*,
    s.title as session_title,
    s.file_name,
    s.duration,
    c.name as client_name,
    c.email as client_email,
    a.name as adviser_name,
    a.email as adviser_email
FROM reports r
JOIN sessions s ON r.session_id = s.id
JOIN clients c ON s.client_id = c.id
JOIN users a ON s.adviser_id = a.id
WHERE r.is_current_version = TRUE;

-- Create a function to get version history for a session/type
CREATE OR REPLACE FUNCTION get_report_version_history(
    p_session_id UUID,
    p_type VARCHAR(50)
)
RETURNS TABLE (
    version_number INTEGER,
    report_id UUID,
    title VARCHAR(255),
    status VARCHAR(50),
    generation_method VARCHAR(50),
    word_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    approved_by_name VARCHAR(255),
    is_current BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.version_number,
        r.id,
        r.title,
        r.status,
        r.generation_method,
        r.word_count,
        r.created_at,
        u.name,
        r.is_current_version
    FROM reports r
    LEFT JOIN users u ON r.approved_by = u.id
    WHERE r.session_id = p_session_id AND r.type = p_type
    ORDER BY r.version_number DESC;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- COMPLETION MESSAGE
-- =============================================================================

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Database setup completed successfully!';
    RAISE NOTICE 'Tables created: users, clients, sessions, reports, jobs';
    RAISE NOTICE 'Views created: report_versions_summary, current_reports';
    RAISE NOTICE 'Functions created: update_updated_at_column, ensure_single_current_version, get_next_job, get_report_version_history';
    RAISE NOTICE 'All indexes, triggers, and RLS policies have been applied';
END $$;
