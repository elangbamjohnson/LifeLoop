-- LifeLoop Database Migration: Add is_admin column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Grant administrator privileges to a specific user by email:
-- UPDATE users SET is_admin = true WHERE email = 'YOUR_EMAIL';
