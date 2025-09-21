# MATI AI Platform - Database Structure & Examples

This document provides a comprehensive overview of all database tables with example data structures.

## 📊 Database Schema Overview

The MATI platform uses PostgreSQL with the following main tables:
- `users` - System users (advisers, admins)
- `clients` - Business clients managed by advisers
- `sessions` - Meeting recordings and processing status
- `reports` - Generated AI reports (future implementation)

---

## 🔐 Users Table

**Purpose**: Store system users (advisers and admins) with authentication and role management.

### Schema:
```sql
CREATE TABLE users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'adviser' CHECK (role IN ('admin', 'adviser')),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Example Data:
```json
{
  "id": "8873a13a-a7b6-4344-8d59-97e40d5d75db",
  "email": "john.adviser@example.com",
  "password_hash": "$2b$10$...",
  "name": "John Smith",
  "role": "adviser",
  "is_active": true,
  "last_login": "2025-09-21T12:30:00.000Z",
  "created_at": "2025-09-15T10:00:00.000Z",
  "updated_at": "2025-09-21T12:30:00.000Z"
}
```

### Roles:
- **admin**: Full system access, user management, all data
- **adviser**: Own clients and sessions only

---

## 👥 Clients Table

**Purpose**: Store business clients managed by advisers with flexible metadata.

### Schema:
```sql
CREATE TABLE clients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    adviser_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Example Data:
```json
{
  "id": "ce9eea41-8b21-40e1-b31a-e0f38bbc1e2e",
  "name": "חברת הייטק",
  "email": "hitech@example.com",
  "phone": "+972-50-123-4567",
  "adviser_id": "8873a13a-a7b6-4344-8d59-97e40d5d75db",
  "metadata": {
    "business_domain": "בינה מלאכותית",
    "business_number": "555123456",
    "industry": "Technology",
    "company_size": "50-100",
    "contact_person": "David Cohen",
    "notes": "Interested in AI consulting services"
  },
  "created_at": "2025-09-20T14:15:00.000Z",
  "updated_at": "2025-09-21T09:20:00.000Z"
}
```

### Metadata Examples:
```json
// Minimal metadata
{
  "business_domain": "יזמות דיגיטלית"
}

// Extended metadata
{
  "business_domain": "פיתוח תוכנה",
  "business_number": "123456789",
  "industry": "Software Development",
  "company_size": "10-50",
  "website": "https://example.com",
  "contact_person": "Sarah Levi",
  "preferred_language": "Hebrew",
  "meeting_preferences": "Online only",
  "notes": "Requires Hebrew reports"
}
```

---

## 🎙️ Sessions Table

**Purpose**: Store meeting recordings with processing status and AI workflow tracking.

### Schema:
```sql
CREATE TABLE sessions (
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
```

### Example Data:
```json
{
  "id": "162de6c4-9592-4834-823c-0055300a35ae",
  "client_id": "ce9eea41-8b21-40e1-b31a-e0f38bbc1e2e",
  "adviser_id": "8873a13a-a7b6-4344-8d59-97e40d5d75db",
  "title": "Business Strategy Meeting - Q4 2025",
  "file_url": "https://res.cloudinary.com/mati/video/upload/v1726920225/mati/sessions/1758456219916_herzog_audio1.mp3",
  "file_name": "herzog-audio1.mp3",
  "file_size": 836962,
  "file_type": "audio/mpeg",
  "duration": 228,
  "status": "transcribed",
  "transcription_text": "שלום, אני רוצה לדבר על האסטרטגיה העסקית שלנו לרבעון הרביעי...",
  "transcription_metadata": {
    "language": "he",
    "confidence": 0.95,
    "speaker_count": 2,
    "processing_time": 45.2,
    "ai_model": "whisper-large-v3"
  },
  "processing_metadata": {
    "ai_job_id": "job_abc123",
    "started_at": "2025-09-21T12:03:45.000Z",
    "completed_at": "2025-09-21T12:04:30.000Z",
    "processing_duration": 45.2,
    "queue_position": 1,
    "retry_count": 0
  },
  "created_at": "2025-09-21T12:03:45.000Z",
  "updated_at": "2025-09-21T12:04:30.000Z"
}
```

### Status Flow:
1. **uploaded** - File uploaded, ready for processing
2. **processing** - AI transcription in progress
3. **transcribed** - Transcription completed
4. **reports_generated** - AI reports created
5. **completed** - All processing finished
6. **failed** - Processing failed

### Metadata Examples:

#### Transcription Metadata:
```json
{
  "language": "he",
  "confidence": 0.95,
  "speaker_count": 2,
  "processing_time": 45.2,
  "ai_model": "whisper-large-v3",
  "segments": [
    {
      "start": 0.0,
      "end": 5.2,
      "text": "שלום, אני רוצה לדבר על האסטרטגיה",
      "speaker": "speaker_1"
    }
  ]
}
```

#### Processing Metadata:
```json
{
  "ai_job_id": "job_abc123",
  "started_at": "2025-09-21T12:03:45.000Z",
  "completed_at": "2025-09-21T12:04:30.000Z",
  "processing_duration": 45.2,
  "queue_position": 1,
  "retry_count": 0,
  "n8n_workflow_id": "workflow_456",
  "cloudinary_public_id": "mati/sessions/1758456219916_herzog_audio1",
  "file_analysis": {
    "audio_quality": "good",
    "noise_level": "low",
    "speech_clarity": "high"
  }
}
```

---

## 📄 Reports Table (Future Implementation)

**Purpose**: Store generated AI reports for advisers and clients.

### Planned Schema:
```sql
CREATE TABLE reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('adviser', 'client')),
    title VARCHAR(255),
    content TEXT,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'review', 'approved', 'sent', 'archived'
    )),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Example Data (Future):
```json
{
  "id": "report_uuid",
  "session_id": "162de6c4-9592-4834-823c-0055300a35ae",
  "type": "adviser",
  "title": "Business Strategy Analysis - חברת הייטק",
  "content": "# Executive Summary\n\nThe meeting focused on Q4 strategy...",
  "metadata": {
    "language": "he",
    "format": "markdown",
    "sections": ["summary", "recommendations", "action_items"],
    "ai_model": "gpt-4",
    "generation_time": 12.5
  },
  "status": "approved",
  "approved_by": "8873a13a-a7b6-4344-8d59-97e40d5d75db",
  "approved_at": "2025-09-21T13:00:00.000Z",
  "sent_at": "2025-09-21T13:05:00.000Z",
  "created_at": "2025-09-21T12:45:00.000Z",
  "updated_at": "2025-09-21T13:00:00.000Z"
}
```

---

## 🔗 Relationships

### Entity Relationship Diagram:
```
users (1) -----> (many) clients
  |                 |
  |                 |
  +-----> (many) sessions (many) <-----+
              |
              |
              v
          (many) reports (future)
```

### Key Relationships:
- **users → clients**: One adviser manages many clients
- **users → sessions**: One adviser creates many sessions
- **clients → sessions**: One client has many sessions
- **sessions → reports**: One session generates multiple reports (adviser + client versions)

---

## 📈 Indexes

### Performance Indexes:
```sql
-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Clients
CREATE INDEX idx_clients_adviser_id ON clients(adviser_id);
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_clients_name ON clients(name);
CREATE INDEX idx_clients_metadata_gin ON clients USING GIN (metadata);

-- Sessions
CREATE INDEX idx_sessions_client_id ON sessions(client_id);
CREATE INDEX idx_sessions_adviser_id ON sessions(adviser_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);
```

---

## 🔒 Row Level Security (RLS)

### Security Policies:
- **Advisers**: Can only access their own clients and sessions
- **Admins**: Can access all data (bypass RLS with service role)
- **Clients**: No direct database access (receive reports via email)

### Example Policies:
```sql
-- Clients RLS
CREATE POLICY "Advisers can view own clients" ON clients
    FOR SELECT USING (adviser_id = auth.uid()::uuid);

-- Sessions RLS  
CREATE POLICY "Advisers can view own sessions" ON sessions
    FOR SELECT USING (adviser_id = auth.uid()::uuid);
```

---

## 🚀 Usage Examples

### Common Queries:

#### Get adviser's clients with session count:
```sql
SELECT 
    c.*,
    COUNT(s.id) as session_count
FROM clients c
LEFT JOIN sessions s ON c.id = s.client_id
WHERE c.adviser_id = $1
GROUP BY c.id
ORDER BY c.name;
```

#### Get sessions ready for AI processing:
```sql
SELECT * FROM sessions 
WHERE status = 'uploaded' 
ORDER BY created_at ASC;
```

#### Search clients by business domain:
```sql
SELECT * FROM clients 
WHERE metadata->>'business_domain' ILIKE '%טכנולוגיה%'
AND adviser_id = $1;
```

---

## 📝 Notes

- All timestamps are stored in UTC with timezone info
- JSONB fields allow flexible metadata without schema changes
- UUIDs provide secure, non-sequential identifiers
- Hebrew text is fully supported (UTF-8)
- File URLs point to Cloudinary CDN
- Status enums ensure data consistency
- Cascading deletes maintain referential integrity

---

*Last updated: 2025-09-21*
