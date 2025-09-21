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
