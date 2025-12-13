-- Add phone field to users table
-- This migration adds a phone number field to the users table for new adviser registrations

-- Add phone column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- Create index on phone for faster lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Update the status default for new registrations to be 'inactive'
-- This will affect new users created after this migration
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'inactive';

-- Add comment to document the change
COMMENT ON COLUMN users.phone IS 'Phone number for user contact information, required for new adviser registrations';
COMMENT ON COLUMN users.status IS 'User status: active, inactive, suspended. New advisers default to inactive until approved by admin';
