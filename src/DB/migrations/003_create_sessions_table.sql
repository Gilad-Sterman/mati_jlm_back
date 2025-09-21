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
        'uploaded', 'processing', 'transcribed', 'reports_generated', 'completed', 'failed'
    )),
    transcription_text TEXT,
    transcription_metadata JSONB DEFAULT '{}',
    processing_metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_adviser_id ON sessions(adviser_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_sessions_updated_at 
    BEFORE UPDATE ON sessions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Advisers can see and manage their own sessions
CREATE POLICY "Advisers can view own sessions" ON sessions
    FOR SELECT USING (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can insert own sessions" ON sessions
    FOR INSERT WITH CHECK (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can update own sessions" ON sessions
    FOR UPDATE USING (adviser_id = auth.uid()::uuid);

-- Note: Admin operations will use the service role key which bypasses RLS
