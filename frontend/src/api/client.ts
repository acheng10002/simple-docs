import axios, { AxiosError } from 'axios';
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  Template,
  UploadResponse,
  MergeRequest,
  MergeJob,
  BulkMergeResponse,
  ErrorResponse,
  OutputType,
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

// Add auth token to requests if it exists
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors globally
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ErrorResponse>) => {
    if (error.response?.status === 401) {
      // Token expired or invalid - clear auth and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
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

  update: async (
    id: string,
    data: {
      displayName?: string;
      defaultOutputType?: OutputType | null;
      outputNameFormat?: string | null;
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

export default apiClient;
