import axios, { AxiosError } from 'axios';
import { supabase } from '../config/supabase';
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  Template,
  TemplateVersion,
  RevertResponse,
  UploadResponse,
  MergeRequest,
  MergeJob,
  BulkMergeResponse,
  BatchJobStatus,
  ErrorResponse,
  OutputType,
  PageSize,
  Orientation,
  Folder,
} from '../types/api';

// API base URL - uses Vite proxy in development, direct URL in production
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add Supabase session token to requests
apiClient.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }

  return config;
});

// Handle auth errors globally with token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ErrorResponse>) => {
    const requestUrl = error.config?.url || '';

    // Don't intercept auth endpoint errors - let them propagate to show error messages
    const isAuthEndpoint = requestUrl.includes('/api/auth/');

    if (error.response?.status === 401 && !isAuthEndpoint) {
      // Try to refresh the session
      const { data: { session }, error: refreshError } =
        await supabase.auth.refreshSession();

      if (refreshError || !session) {
        // Refresh failed - sign out and redirect to login
        await supabase.auth.signOut();
        localStorage.removeItem('user');
        window.location.href = '/login';
      } else if (error.config) {
        // Retry the original request with new token
        error.config.headers.Authorization = `Bearer ${session.access_token}`;
        return axios.request(error.config);
      }
    }
    return Promise.reject(error);
  }
);

// Authentication API
export const authApi = {
  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/api/auth/register', data);
    return response.data;
  },

  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/api/auth/login', data);
    return response.data;
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/api/auth/forgot-password', { email });
    return response.data;
  },

  resetPassword: async (password: string, accessToken: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      '/api/auth/reset-password',
      { password },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data;
  },

  updateEmail: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.put<{ message: string }>(
      '/api/auth/update-email',
      { email }
    );
    return response.data;
  },

  updatePassword: async (currentPassword: string, newPassword: string): Promise<{ message: string }> => {
    const response = await apiClient.put<{ message: string }>(
      '/api/auth/update-password',
      { currentPassword, newPassword }
    );
    return response.data;
  },
};

// Templates API
export const templatesApi = {
  getAll: async (): Promise<Template[]> => {
    const response = await apiClient.get<Template[]>('/api/templates');
    return response.data;
  },

  getById: async (id: string): Promise<Template> => {
    const response = await apiClient.get<Template>(`/api/templates/${id}`);
    return response.data;
  },

  upload: async (file: File): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('template', file);

    const response = await apiClient.post<UploadResponse>('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/templates/${id}`);
  },

  activate: async (id: string): Promise<void> => {
    await apiClient.post(`/api/templates/${id}/activate`);
  },

  update: async (
    id: string,
    data: {
      displayName?: string;
      defaultOutputType?: OutputType | null;
      outputNameFormat?: string | null;
      pageSize?: PageSize | null;
      orientation?: Orientation | null;
      file?: File;
    }
  ): Promise<Template> => {
    const formData = new FormData();

    if (data.displayName) {
      formData.append('displayName', data.displayName);
    }

    if (data.defaultOutputType !== undefined) {
      formData.append('defaultOutputType', data.defaultOutputType || '');
    }

    if (data.outputNameFormat !== undefined) {
      formData.append('outputNameFormat', data.outputNameFormat || '');
    }

    if (data.pageSize !== undefined) {
      formData.append('pageSize', data.pageSize || '');
    }

    if (data.orientation !== undefined) {
      formData.append('orientation', data.orientation || '');
    }

    if (data.file) {
      formData.append('template', data.file);
    }

    const response = await apiClient.put<Template>(`/api/templates/${id}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  download: async (id: string): Promise<Blob> => {
    const response = await apiClient.get(`/api/templates/${id}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  getVersions: async (id: string): Promise<TemplateVersion[]> => {
    const response = await apiClient.get<TemplateVersion[]>(
      `/api/templates/${id}/versions`
    );
    return response.data;
  },

  revertToVersion: async (
    templateId: string,
    versionId: string
  ): Promise<RevertResponse> => {
    const response = await apiClient.post<RevertResponse>(
      `/api/templates/${templateId}/versions/${versionId}/revert`
    );
    return response.data;
  },
};

// Folders API
export const foldersApi = {
  getAll: async (): Promise<Folder[]> => {
    const response = await apiClient.get<Folder[]>('/api/folders');
    return response.data;
  },

  create: async (data: { name: string; parentId?: string | null }): Promise<Folder> => {
    const response = await apiClient.post<Folder>('/api/folders', data);
    return response.data;
  },

  rename: async (id: string, data: { name: string }): Promise<Folder> => {
    const response = await apiClient.put<Folder>(`/api/folders/${id}`, data);
    return response.data;
  },

  move: async (id: string, data: { newParentId: string | null }): Promise<Folder> => {
    const response = await apiClient.put<Folder>(`/api/folders/${id}/move`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/folders/${id}`);
  },

  moveTemplate: async (templateId: string, data: { folderId: string | null }): Promise<Template> => {
    const response = await apiClient.put<Template>(`/api/templates/${templateId}/move`, data);
    return response.data;
  },
};

// Merge API
export const mergeApi = {
  mergeSingle: async (
    templateId: string,
    request: MergeRequest
  ): Promise<MergeJob> => {
    const response = await apiClient.post<MergeJob>(
      `/api/templates/${templateId}/merge`,
      request
    );
    return response.data;
  },

  testMerge: async (
    templateId: string,
    request: MergeRequest
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.post(
      `/api/templates/${templateId}/merge`,
      { ...request, testMode: true },
      { responseType: 'blob' }
    );
    // Extract filename from Content-Disposition header
    const contentDisposition = response.headers['content-disposition'];
    let filename = 'test-output';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="(.+)"/);
      if (match) {
        filename = match[1];
      }
    }
    return { blob: response.data, filename };
  },

  mergeCsv: async (
    templateId: string,
    csvFile: File,
    outputType: OutputType
  ): Promise<BulkMergeResponse> => {
    const formData = new FormData();
    formData.append('csv', csvFile);
    formData.append('outputType', outputType);

    const response = await apiClient.post<BulkMergeResponse>(
      `/api/templates/${templateId}/merge-csv`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  },

  downloadOutput: async (filePath: string): Promise<Blob> => {
    const response = await apiClient.get(`/api/download/${filePath}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};

// Jobs API
export const jobsApi = {
  getAll: async (): Promise<MergeJob[]> => {
    const response = await apiClient.get<MergeJob[]>('/api/jobs');
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/jobs/${id}`);
  },
};

// Batch Jobs API
export const batchJobsApi = {
  getStatus: async (batchJobId: string): Promise<BatchJobStatus> => {
    const response = await apiClient.get<BatchJobStatus>(`/api/batch-jobs/${batchJobId}`);
    return response.data;
  },
};

export default apiClient;
