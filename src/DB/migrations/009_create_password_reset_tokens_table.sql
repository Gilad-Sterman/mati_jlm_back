-- Create password reset tokens table for secure password reset functionality
-- This table stores temporary tokens for password reset requests

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_used_at ON password_reset_tokens(used_at);

-- Create trigger to automatically update updated_at timestamp
CREATE TRIGGER update_password_reset_tokens_updated_at 
    BEFORE UPDATE ON password_reset_tokens 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Note: These policies are restrictive since password reset tokens are sensitive
-- Most operations will use the service role key which bypasses RLS

-- Users can only view their own password reset tokens (for debugging/admin purposes)
CREATE POLICY "Users can view own password reset tokens" ON password_reset_tokens
    FOR SELECT USING (auth.uid()::uuid = user_id);

-- No insert/update/delete policies - these operations should only be done via service role
-- This ensures all password reset operations go through the backend API with proper validation

-- Add comments for documentation
COMMENT ON TABLE password_reset_tokens IS 'Stores temporary tokens for secure password reset functionality';
COMMENT ON COLUMN password_reset_tokens.id IS 'Unique identifier for the password reset token';
COMMENT ON COLUMN password_reset_tokens.user_id IS 'Foreign key reference to the user requesting password reset';
COMMENT ON COLUMN password_reset_tokens.token IS 'Secure random token used for password reset verification';
COMMENT ON COLUMN password_reset_tokens.expires_at IS 'Timestamp when the token expires (typically 1 hour from creation)';
COMMENT ON COLUMN password_reset_tokens.used_at IS 'Timestamp when the token was used (NULL if unused)';
COMMENT ON COLUMN password_reset_tokens.created_at IS 'Timestamp when the token was created';
COMMENT ON COLUMN password_reset_tokens.updated_at IS 'Timestamp when the record was last updated';

-- Create a function to clean up expired tokens (optional - for maintenance)
CREATE OR REPLACE FUNCTION cleanup_expired_password_reset_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete tokens that are older than 24 hours (well past expiration)
    DELETE FROM password_reset_tokens 
    WHERE created_at < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_expired_password_reset_tokens() IS 'Utility function to clean up old password reset tokens. Can be called periodically for maintenance.';
