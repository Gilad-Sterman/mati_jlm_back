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

-- Create index on adviser_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_clients_adviser_id ON clients(adviser_id);

-- Create index on email for searching
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

-- Create index on name for searching
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_clients_updated_at 
    BEFORE UPDATE ON clients 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Advisers can see and manage their own clients
CREATE POLICY "Advisers can view own clients" ON clients
    FOR SELECT USING (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can insert own clients" ON clients
    FOR INSERT WITH CHECK (adviser_id = auth.uid()::uuid);

CREATE POLICY "Advisers can update own clients" ON clients
    FOR UPDATE USING (adviser_id = auth.uid()::uuid);

-- Note: Admin operations (viewing all clients, deleting clients, etc.)
-- will use the service role key which bypasses RLS entirely
