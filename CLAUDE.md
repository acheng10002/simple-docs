# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Simple Docs is a multi-user document templating system that merges placeholder data into templates and converts to various output formats. It supports single-record merges and CSV batch processing.

**Template formats**: DOCX, HTML, PDF, XLSX, PPTX

**Output formats by template type**:
- DOCX → pdf, docx, html, jpg
- HTML → pdf, docx, html
- PDF → pdf, jpg
- XLSX → xlsx, pdf
- PPTX → pptx, ppsx, pdf, jpg

## Commands

### Backend (`/backend`)
```bash
npm run dev          # Start Express server on port 3000
npm test             # Run Jest tests (sequential with --runInBand)
npm test -- --testPathPattern="services/merge"  # Run specific test file
```

### Frontend (`/frontend`)
```bash
npm run dev          # Vite dev server on port 5173 (proxies /api to backend)
npm run build        # TypeScript check + production build
npm run lint         # ESLint
npm test             # Vitest single run
npm run test:watch   # Vitest watch mode
```

### Database
```bash
npx prisma migrate dev       # Apply migrations
npx prisma db push           # Sync schema without migration (preserves data)
npx prisma studio            # Open database GUI
```

## Environment Variables

### Required (backend exits on startup if missing)
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (pooled) |
| `DIRECT_URL` | PostgreSQL connection string (direct, used by rate limiter) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) |
| `S3_BUCKET` | Supabase Storage bucket name |
| `JWT_SECRET` | Reserved for JWT signing |
| `WEBHOOK_SECRET` | HMAC secret for webhook signature verification |
| `CLEANUP_SECRET` | Bearer token for the scheduled cleanup endpoint |
| `FRONTEND_URL` | Frontend origin for CORS allow-list |

### Optional (with defaults)
| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `info` | Pino log level |
| `OUTPUT_RETENTION_DAYS` | `90` | Days before merge outputs are cleaned up |
| `DATABASE_CA_CERT` | — | PEM certificate for TLS-validated DB connections |
| `SOFFICE_BIN` | auto-detected | Path to LibreOffice `soffice` binary |
| `PUPPETEER_EXECUTABLE_PATH` | bundled | Path to Chromium binary for Puppeteer |
| `CONVERSION_USE_WORKER` | `true` | Use isolated worker for HTML conversions (`false` = in-process) |
| `CONVERSION_TIMEOUT_MS` | `120000` | Conversion worker request timeout |
| `CONVERSION_MAX_RESTARTS` | `5` | Max worker crash restarts before giving up |
| `MAX_CONCURRENT_MERGES` | `3` | Merge semaphore limit |
| `MAX_CONCURRENT_CONVERSIONS` | `2` | Conversion semaphore limit |
| `MEMORY_THRESHOLD` | `0.80` | V8 heap ratio that triggers 503 rejection |
| `TEMPLATE_CACHE_MAX_BYTES` | `52428800` | Template cache max size (50 MB) |
| `TEMPLATE_CACHE_MAX_ENTRY_BYTES` | `5242880` | Max single cache entry (5 MB) |
| `TEMPLATE_CACHE_TTL_MS` | `300000` | Cache TTL (5 minutes) |
| `BATCH_INLINE_THRESHOLD` | `10` | Max rows processed inline (above this = background job) |
| `BATCH_INLINE_CONCURRENCY` | `3` | Parallel rows during inline batch processing |
| `STORAGE_PREFIX` | — | Optional path prefix for all S3 keys |
| `STORAGE_MAX_RETRIES` | `3` | S3 operation retry count |

### Frontend
| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (required) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (required) |
| `VITE_API_URL` | Backend URL for production (optional, uses proxy in dev) |
| `DEV_PROXY_TARGET` | Dev-server proxy target (default: `http://localhost:3000`) |

## Deployment

- **Backend**: Render (`https://mergemydocs.onrender.com`)
- **Frontend**: Vercel (`https://mergemydocs.vercel.app`) with `vercel.json` rewrite for SPA routing
- Vercel auto-deploys on push to main

## Architecture

### Backend Structure

**Request flow**: Express middleware stack → Route handlers → Services → Prisma/Storage

**Authentication**: Supabase Auth issues JWTs. Backend middleware (`supabase-auth.js`) verifies tokens and attaches both `req.user` (database record) and `req.supabaseUser` (Supabase identity).

**Service layer pattern**:
- Format-specific services (`docxService.js`, `htmlService.js`, `xlsxService.js`, `pptxService.js`) handle template parsing and placeholder merging
- `merge.service.js` orchestrates: loads template from cache/S3 → delegates to format service → converts if needed → uploads output to S3
- `conversionService.js` uses Puppeteer in isolated worker process (`workers/workerManager.js`) for HTML→PDF/JPG

**Batch processing** (`batchJob.service.js`):
- CSV ≤10 rows: Process inline with bounded concurrency (3 parallel)
- CSV >10 rows: Create BatchJob record, process via `setImmediate`, track progress in database

**Rate limiting**: PostgreSQL-backed (`@acpr/rate-limit-postgresql`) for multi-instance consistency.

### Frontend Structure

**Routing**: react-router-dom with `ProtectedRoute` wrapper checking auth context.

**State management**: `SupabaseAuthContext` manages session/user globally. Page components manage their own data state.

**API client** (`api/client.ts`): Axios instance with interceptors that attach JWT and handle 401 token refresh.

### Key Data Models (Prisma)

- **Template**: File metadata + settings (storageKey, outputType, pageSize, orientation)
- **TemplateVersion**: Historical snapshots for version control
- **Field**: Placeholder names extracted from templates
- **MergeJob**: Single merge audit trail (status, filePath, error)
- **BatchJob**: CSV batch state (rows JSON, results JSON, progress counters)
- **Folder**: Hierarchical organization (parentId, depth max 4)

### Storage

Supabase S3-compatible storage. Keys follow pattern: `uploads/{timestamp}-{uuid}-{filename}`. Template buffers are cached in-memory (`templateCache.js`) to reduce S3 downloads.

## Key Patterns

**Error handling**: Errors are logged to `ErrorLog` table with context. PII (emails) are hashed before logging (`utils/pii.js`).

**Validation**: Zod schemas in `schemas/` directory, applied via `validate.js` middleware.

**Concurrency**: `utils/concurrency.js` provides semaphore to limit parallel merge operations.

**CSV security**: `csv-sanitizer.js` validates structure and prevents formula injection.

**CORS**: In production, allows only the origin set in `FRONTEND_URL` env var. In development, allows `localhost:5173`.
