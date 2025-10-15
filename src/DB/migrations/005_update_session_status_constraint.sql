-- Update session status constraint to include new advisor report status
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;

ALTER TABLE sessions ADD CONSTRAINT sessions_status_check 
CHECK (status IN (
    'uploaded', 
    'processing', 
    'transcribed', 
    'advisor_report_generated',
    'reports_generated', 
    'completed', 
    'failed'
));
