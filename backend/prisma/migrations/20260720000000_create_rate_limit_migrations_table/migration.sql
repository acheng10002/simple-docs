-- Create the migrations tracking table that @acpr/rate-limit-postgresql
-- (via postgres-migrations) expects. Without this table, the library's
-- migration runner collides with Supabase's built-in storage.migrations
-- table and never bootstraps the rate_limit schema.
CREATE TABLE IF NOT EXISTS public.migrations (
  id integer PRIMARY KEY,
  name varchar(100) UNIQUE NOT NULL,
  hash varchar(40) NOT NULL,
  executed_at timestamp DEFAULT current_timestamp
);

ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;
