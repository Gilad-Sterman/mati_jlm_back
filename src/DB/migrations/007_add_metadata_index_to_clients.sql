-- Add GIN index on metadata field for better JSON query performance
-- This improves performance for searches like metadata->>'business_domain'

CREATE INDEX IF NOT EXISTS idx_clients_metadata_gin ON clients USING GIN (metadata);
