# Simple Docs

A multi-user document templating system. Upload a template, fill its placeholders with data (single record or a CSV batch), and export to the format you need.

- **Template formats:** DOCX, HTML, PDF, XLSX, PPTX
- **Output formats** (by template type):
  | Template | Outputs |
  |----------|---------|
  | DOCX     | pdf, docx, html, jpg |
  | HTML     | pdf, docx, html |
  | PDF      | pdf, jpg |
  | XLSX     | xlsx, pdf |
  | PPTX     | pptx, ppsx, pdf, jpg |

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TypeScript, MUI, React Router |
| Backend | Node.js, Express, Prisma |
| Database | PostgreSQL |
| Auth | Supabase Auth (JWT) |
| Storage | Supabase Storage (S3-compatible) |
| Conversion | LibreOffice (office → pdf/jpg), Puppeteer/Chromium (html → pdf/jpg) |

## Architecture

```
frontend (Vite :5173)  ──/api proxy──▶  backend (Express :3000)  ──▶  Postgres (Prisma)
      │                                          │
      └──────────── Supabase Auth ───────────────┴──▶ Supabase Storage
```

- **Request flow:** Express middleware → route handlers → services → Prisma/Storage.
- **Auth:** Supabase Auth issues JWTs; backend middleware verifies them and attaches `req.user` (DB record) and `req.supabaseUser` (Supabase identity).
- **Services:** format-specific services (`docxService`, `htmlService`, `xlsxService`, `pptxService`) handle parsing and placeholder merging; `merge.service` orchestrates load → merge → convert → upload; `conversionService` runs Puppeteer in an isolated worker.
- **Batch processing:** CSV ≤10 rows runs inline (bounded concurrency); larger CSVs create a `BatchJob` tracked in the database.
- **Rate limiting:** PostgreSQL-backed for multi-instance consistency.

Storage keys follow `uploads/{timestamp}-{uuid}-{filename}`; template buffers are cached in-memory to reduce downloads. Two storage buckets are used: `templates` (uploads) and `outputs` (generated files).

## Prerequisites

- **Node.js** 20+ (developed on 22)
- **Docker** (for the local Supabase stack)
- **[Supabase CLI](https://supabase.com/docs/guides/local-development)**
- **LibreOffice** — required for office-format conversions (DOCX/XLSX/PPTX → PDF/JPG). Puppeteer downloads its own Chromium for HTML conversions.

## Local development

This runs the app **fully locally** using the Supabase CLI — no cloud account required.

### 1. Install dependencies

```bash
cd backend  && npm install
cd ../frontend && npm install
```

### 2. Start the local Supabase stack

From the repo root:

```bash
supabase init      # first time only; creates supabase/config.toml
supabase start     # pulls Docker images, then prints your local URL + keys
```

Note the `API URL`, `anon key`, `service_role key`, and `DB URL` it prints. Create the two storage buckets the app expects:

```bash
export SRK="<service_role key from supabase start>"
for b in templates outputs; do
  curl -s -X POST "http://127.0.0.1:54321/storage/v1/bucket" \
    -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "{\"id\":\"$b\",\"name\":\"$b\",\"public\":false}"
done
```

### 3. Configure environment variables

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill in the values from `supabase start`. For a local stack the database URLs point at the local container and **must** include `?sslmode=disable` (see [Troubleshooting](#troubleshooting)). Key backend variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL connection strings (pooled / direct) |
| `SUPABASE_URL` | Supabase API URL |
| `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase keys |
| `S3_BUCKET` | Required at startup (adapter uses the hardcoded `templates`/`outputs` buckets) |
| `WEBHOOK_SECRET` / `CLEANUP_SECRET` | Secrets guarding webhook + cleanup endpoints |
| `FRONTEND_URL` | CORS allow-list + password-reset redirect |
| `SOFFICE_BIN` | Path to LibreOffice `soffice` binary |

Frontend (`.env.local`): set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `DEV_PROXY_TARGET=http://localhost:3000` so the dev-server proxy targets your local backend. See `.env.example` in each directory for the full list.

### 4. Apply database migrations

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

### 5. Run the apps

```bash
# terminal 1 — backend on :3000
cd backend && npm run dev

# terminal 2 — frontend on :5173
cd frontend && npm run dev
```

Open http://localhost:5173, register an account, and start uploading templates. Check backend health at http://localhost:3000/health.

## Commands

### Backend (`/backend`)
```bash
npm run dev     # start Express server on :3000
npm test        # Jest (sequential, --runInBand)
```

### Frontend (`/frontend`)
```bash
npm run dev     # Vite dev server on :5173 (proxies /api to the backend)
npm run build   # type-check + production build
npm run lint    # ESLint
npm test        # Vitest (single run)
```

### Database
```bash
npx prisma migrate dev    # create/apply a migration in dev
npx prisma db push        # sync schema without a migration (preserves data)
npx prisma studio         # open the database GUI
```

## Project structure

```
backend/
  src/
    routes/       auth, template, merge, folder, admin
    services/     format-specific + merge/conversion orchestration
    storage/      Supabase Storage adapter
    middleware/   auth, rate limiting, validation, upload, memory guard
    schemas/      Zod validation schemas
    workers/      isolated Puppeteer conversion worker
  prisma/         schema + migrations
frontend/
  src/            pages, components, api client, auth context
  tests/          Vitest
supabase/         local stack config (config.toml)
docker-compose.yml   containerized backend (LibreOffice + Chromium baked in)
```

## Docker

The backend ships a `Dockerfile` (with LibreOffice + Chromium) and a `docker-compose.yml`. It still requires a database and Supabase project via `backend/.env`:

```bash
docker compose up -d       # or: npm run docker:up  (from /backend)
docker compose logs -f app
```

## Deployment

- **Backend:** Render — `https://simple-docs-9u3r.onrender.com`
- **Frontend:** Vercel — `https://simple-docs-two.vercel.app` (SPA rewrites in `vercel.json`, auto-deploys on push to `main`)

In production, set all backend variables in the host's environment (not a committed file), point the database URLs at your managed Postgres **with TLS enabled** (do not use `sslmode=disable`), and set `VITE_API_URL` on the frontend to the deployed backend URL.

## Troubleshooting

**`The server does not support SSL connections`** — the rate limiter's `pg` pool negotiates SSL unless the connection URL opts out. For a local Postgres that doesn't support TLS, append `?sslmode=disable` to `DATABASE_URL` and `DIRECT_URL`. Never do this in production.

**`schema "rate_limit" does not exist`** — the rate-limit store (`@acpr/rate-limit-postgresql`) bootstraps its schema via `postgres-migrations`, whose table-existence check collides with Supabase's built-in `storage.migrations` table and aborts. Work around it by pre-creating an empty tracking table, then let the store's migrations run:

```sql
CREATE TABLE IF NOT EXISTS public.migrations (
  id integer PRIMARY KEY,
  name varchar(100) UNIQUE NOT NULL,
  hash varchar(40) NOT NULL,
  executed_at timestamp DEFAULT current_timestamp
);
```

Restart the backend once; it will populate the `rate_limit` schema on boot. (Recommended: `ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;` to match the project's RLS-on-all-public-tables convention — the backend connects as a superuser and bypasses RLS.)

**Office conversions fail** — ensure LibreOffice is installed and `SOFFICE_BIN` points at the `soffice` binary (e.g. `C:\Program Files\LibreOffice\program\soffice.exe` on Windows, `soffice` on PATH elsewhere).
