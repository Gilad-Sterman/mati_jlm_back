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

-- Create indexes for efficient querying
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

-- Enable Row Level Security
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Advisers can see and manage reports for their own sessions
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

-- Note: Admin operations will use the service role key which bypasses RLS
