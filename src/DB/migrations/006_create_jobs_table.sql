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

-- Create indexes for efficient job processing
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

-- Enable Row Level Security
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Advisers can see jobs for their own sessions
CREATE POLICY "Advisers can view own session jobs" ON jobs
    FOR SELECT USING (
        session_id IS NULL OR -- Allow system jobs with no session
        EXISTS (
            SELECT 1 FROM sessions s 
            WHERE s.id = jobs.session_id 
            AND s.adviser_id = auth.uid()::uuid
        )
    );

-- Only the system (service role) should create and update jobs
-- Regular users don't directly manipulate the job queue
-- This will be handled by our backend API with proper authorization

-- Note: Job creation, updates, and processing will use the service role key
