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
