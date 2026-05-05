// API Type Definitions
// These mirror your backend's API responses

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Field {
  id?: string;
  name: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    templates: number;
    children: number;
  };
}

export type PageSize = 'letter' | 'legal' | 'a4' | 'a3' | 'tabloid';
export type Orientation = 'portrait' | 'landscape';

export interface Template {
  id: string;
  displayName: string;  // User-friendly template name (e.g. "My Invoice.docx")
  storageKey?: string;
  mimeType?: string;
  fields: Field[];
  createdAt?: string;
  isActive?: boolean;
  folderId?: string | null;
  folder?: Folder | null;
  defaultOutputType?: OutputType | null;
  outputNameFormat?: string | null;
  pageSize?: PageSize | null;
  orientation?: Orientation | null;
}

export interface TemplateVersion {
  id: string;
  versionNumber: number;
  displayName: string;
  mimeType: string;
  storageKey: string;
  createdAt: string;
  fieldsSnapshot: Array<{
    id: string;
    name: string;
  }>;
}

export interface RevertResponse {
  message: string;
  template: Template;
}

export interface UploadResponse {
  templateId: string;
  fields: string[];
  message: string;
}

export type OutputType = 'pdf' | 'docx' | 'html' | 'xlsx' | 'pptx' | 'ppsx' | 'jpg';

export interface MergeRequest {
  data: Record<string, string>;
  outputType: OutputType;
}

export interface MergeJob {
  id?: number;
  jobId?: string;
  templateId?: string;
  userId?: string;
  data?: Record<string, any>;
  outputType?: OutputType;
  status?: 'queued' | 'processing' | 'succeeded' | 'failed';
  filePath: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  template?: {
    id: string;
    displayName: string;
    mimeType?: string;
  };
}

export interface BulkMergeResponse {
  count: number;
  jobs: MergeJob[];
  warnings?: Array<{
    row: number;
    warnings: string[];
  }>;
  // Fields present when batch job is queued (>10 rows)
  batchJobId?: string;
  totalRows?: number;
  statusUrl?: string;
  message?: string;
}

export interface BatchJobStatus {
  id: string;
  templateId: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  totalRows: number;
  processedRows: number;
  failedRows: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ErrorResponse {
  error: string;
  details?: unknown;
}
