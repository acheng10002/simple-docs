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
  name: string;
}

export interface Template {
  id: string;
  name: string;
  fields: Field[];
  createdAt?: string;
}

export interface UploadResponse {
  templateId: string;
  fields: string[];
  message: string;
}

export interface MergeRequest {
  data: Record<string, string>;
  outputType: 'pdf' | 'docx' | 'html';
}

export interface MergeJob {
  id?: number;
  jobId?: string;
  templateId?: string;
  userId?: string;
  data?: Record<string, any>;
  outputType?: 'pdf' | 'docx' | 'html';
  status?: 'queued' | 'processing' | 'succeeded' | 'failed';
  filePath: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  template?: {
    id: string;
    name: string;
  };
}

export interface BulkMergeResponse {
  count: number;
  jobs: MergeJob[];
  warnings?: Array<{
    row: number;
    warnings: string[];
  }>;
}

export interface ErrorResponse {
  error: string;
  details?: unknown;
}
