-- Initialization only. Upgrade changes require a reviewed migration on existing data.
ALTER ROLE authenticator CONNECTION LIMIT 10; -- 8 pool + listener/administration headroom
ALTER ROLE supabase_auth_admin CONNECTION LIMIT 4;
ALTER ROLE supabase_storage_admin CONNECTION LIMIT 5; -- 4 API + one queue connection
ALTER ROLE authenticator SET statement_timeout = '10s';
ALTER ROLE authenticator SET lock_timeout = '2s';
ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE supabase_auth_admin SET statement_timeout = '10s';
ALTER ROLE supabase_storage_admin SET statement_timeout = '10s';
