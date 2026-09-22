-- Phase 7.5A-1 Email Verification
-- Policy: All pre-existing users become account_status='active' and email_verified_at=now()
-- Note: This script must be run against the database as part of schema migration, 
-- or manually against production (similar to grant-admin.sql) to prevent locking out existing users.

UPDATE users
SET account_status = 'active', 
    email_verified_at = NOW()
WHERE account_status = 'pending_verification';
