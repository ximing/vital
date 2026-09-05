# @vital/server

Fastify 5 + Drizzle + PostgreSQL. Port **3010**. Cookie auth only when `Origin` matches `WEB_ORIGIN`; otherwise bearer.

## Local

```bash
cp .env.example .env   # then replace change-me values; never commit .env
pnpm --filter @vital/dto build
pnpm --filter @vital/server migrate
pnpm --filter @vital/server dev
```

Health: `GET /api/health`. Ready: `GET /api/v1/health/ready` (`SELECT 1`).

Tests use `NODE_ENV=test` and `apps/server/.env.test` against local compose Postgres (`vital_test` on host **5433**).

```bash
docker compose up -d postgres
pnpm --filter @vital/server test
```

## PostgreSQL runbook (remote)

Host `222.128.65.91`. Admin: `ssh root@222.128.65.91 -p 11023`. Assume Postgres `127.0.0.1:5432` until `ss` says otherwise. Laptop tunnel:

```bash
ssh -N -L 15432:127.0.0.1:5432 root@222.128.65.91 -p 11023
```

Generate role passwords locally (`openssl rand -hex 32`). **Do not reuse leaked draft values.**

```sql
CREATE ROLE vital_dev_user WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  PASSWORD 'change-me-generate-locally';

CREATE ROLE vital_prod_user WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  PASSWORD 'change-me-generate-locally';

CREATE ROLE vital_test_user WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
  PASSWORD 'change-me-generate-locally';

CREATE DATABASE vital_dev
  OWNER vital_dev_user
  ENCODING 'UTF8'
  LC_COLLATE 'C.UTF-8'
  LC_CTYPE 'C.UTF-8'
  TEMPLATE template0;

CREATE DATABASE vital_prod
  OWNER vital_prod_user
  ENCODING 'UTF8'
  LC_COLLATE 'C.UTF-8'
  LC_CTYPE 'C.UTF-8'
  TEMPLATE template0;

-- CI / tests (compose uses vital_test_user / change-me-test)
CREATE DATABASE vital_test
  OWNER vital_test_user
  ENCODING 'UTF8'
  LC_COLLATE 'C.UTF-8'
  LC_CTYPE 'C.UTF-8'
  TEMPLATE template0;
```

On Ubuntu the libc locale name may be `C.utf8` (same collation). Re-run roles with:

```sql
DO $$ BEGIN CREATE ROLE vital_dev_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT PASSWORD 'change-me-generate-locally';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE vital_dev_user PASSWORD 'change-me-generate-locally';
```

Lock down + extensions **as superuser** (app role does not `CREATE EXTENSION`):

```sql
REVOKE ALL ON DATABASE vital_dev FROM PUBLIC;
GRANT CONNECT, TEMP ON DATABASE vital_dev TO vital_dev_user;

\c vital_dev
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO vital_dev_user;
ALTER SCHEMA public OWNER TO vital_dev_user;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO vital_dev_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO vital_dev_user;
```

Repeat for `vital_prod` / `vital_prod_user` and `vital_test` / `vital_test_user`. Then `pnpm --filter @vital/server migrate` as `vital_dev_user`.

## S3

Private bucket `vital`, prefix `dev/attachments` or `prod/attachments`. Copy keys from the operator's ignored Moment env into ignored `apps/server/.env`. `s3.aimo.plus` is not Aliyun → path-style. No LLM env in v1.
