-- Extensions required by the budget-tracker schema.
-- Runs automatically on first Postgres container boot via the
-- docker-entrypoint-initdb.d mount in docker-compose.dev.yml.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
