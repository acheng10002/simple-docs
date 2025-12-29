import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import apiClient, { authApi, templatesApi, mergeApi, jobsApi } from './client';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock window.location
delete (window as any).location;
window.location = { href: '' } as any;

describe('API Client', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(apiClient);
    localStorageMock.clear();
    window.location.href = '';
  });

  afterEach(() => {
    mock.restore();
  });

  describe('Request Interceptor', () => {
    it('should add Authorization header when token exists', async () => {
      localStorageMock.setItem('token', 'test-token');

      mock.onGet('/api/test').reply((config) => {
        expect(config.headers?.Authorization).toBe('Bearer test-token');
        return [200, { success: true }];
      });

      await apiClient.get('/api/test');
    });

    it('should not add Authorization header when token does not exist', async () => {
      mock.onGet('/api/test').reply((config) => {
        expect(config.headers?.Authorization).toBeUndefined();
        return [200, { success: true }];
      });

      await apiClient.get('/api/test');
    });
  });

  describe('Response Interceptor', () => {
    it('should handle 401 error by clearing storage and redirecting', async () => {
      localStorageMock.setItem('token', 'test-token');
      localStorageMock.setItem('user', JSON.stringify({ id: '1', email: 'test@example.com' }));

      mock.onGet('/api/test').reply(401, { error: 'Unauthorized' });

      try {
        await apiClient.get('/api/test');
      } catch (error) {
        // Error is expected
      }

      expect(localStorageMock.getItem('token')).toBeNull();
      expect(localStorageMock.getItem('user')).toBeNull();
      expect(window.location.href).toBe('/login');
    });

    it('should not clear storage for non-401 errors', async () => {
      localStorageMock.setItem('token', 'test-token');

      mock.onGet('/api/test').reply(500, { error: 'Server Error' });

      try {
        await apiClient.get('/api/test');
      } catch (error) {
        // Error is expected
      }

      expect(localStorageMock.getItem('token')).toBe('test-token');
      expect(window.location.href).toBe('');
    });
  });

  describe('authApi', () => {
    it('should register a new user', async () => {
      const mockRequest = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
      };

      const mockResponse = {
        token: 'test-token',
        user: { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' },
      };

      mock.onPost('/api/auth/register', mockRequest).reply(200, mockResponse);

      const result = await authApi.register(mockRequest);

      expect(result).toEqual(mockResponse);
    });

    it('should login a user', async () => {
      const mockRequest = {
        email: 'test@example.com',
        password: 'password123',
      };

      const mockResponse = {
        token: 'test-token',
        user: { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' },
      };

      mock.onPost('/api/auth/login', mockRequest).reply(200, mockResponse);

      const result = await authApi.login(mockRequest);

      expect(result).toEqual(mockResponse);
    });

    it('should handle login error', async () => {
      const mockRequest = {
        email: 'test@example.com',
        password: 'wrong-password',
      };

      mock.onPost('/api/auth/login', mockRequest).reply(401, { error: 'Invalid credentials' });

      await expect(authApi.login(mockRequest)).rejects.toThrow();
    });
  });

  describe('templatesApi', () => {
    it('should get all templates', async () => {
      const mockTemplates = [
        {
          id: '1',
          name: 'Template 1',
          fields: [{ id: '1', name: 'field1', templateId: '1' }],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          uploadedById: 'user1',
        },
      ];

      mock.onGet('/api/templates').reply(200, mockTemplates);

      const result = await templatesApi.getAll();

      expect(result).toEqual(mockTemplates);
    });

    it('should get template by id', async () => {
      const mockTemplate = {
        id: '1',
        name: 'Template 1',
        fields: [{ id: '1', name: 'field1', templateId: '1' }],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      };

      mock.onGet('/api/templates/1').reply(200, mockTemplate);

      const result = await templatesApi.getById('1');

      expect(result).toEqual(mockTemplate);
    });

    it('should upload a template', async () => {
      const mockFile = new File(['content'], 'test.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const mockResponse = {
        id: '1',
        name: 'test.docx',
        fields: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      };

      mock.onPost('/api/upload').reply((config) => {
        expect(config.headers?.['Content-Type']).toBe('multipart/form-data');
        return [200, mockResponse];
      });

      const result = await templatesApi.upload(mockFile);

      expect(result).toEqual(mockResponse);
    });

    it('should delete a template', async () => {
      mock.onDelete('/api/templates/1').reply(204);

      await expect(templatesApi.delete('1')).resolves.toBeUndefined();
    });

    it('should download a template', async () => {
      const mockBlob = new Blob(['template content'], { type: 'application/octet-stream' });

      mock.onGet('/api/templates/1/download').reply((config) => {
        expect(config.responseType).toBe('blob');
        return [200, mockBlob];
      });

      const result = await templatesApi.download('1');

      expect(result).toBeInstanceOf(Blob);
    });
  });

  describe('mergeApi', () => {
    it('should merge single template', async () => {
      const mockRequest = {
        data: { field1: 'value1', field2: 'value2' },
        outputType: 'pdf' as const,
      };

      const mockResponse = {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        data: { field1: 'value1', field2: 'value2' },
        outputType: 'pdf' as const,
        status: 'succeeded' as const,
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      mock.onPost('/api/templates/template1/merge', mockRequest).reply(200, mockResponse);

      const result = await mergeApi.mergeSingle('template1', mockRequest);

      expect(result).toEqual(mockResponse);
    });

    it('should merge CSV', async () => {
      const mockCsvFile = new File(['col1,col2\nval1,val2'], 'test.csv', { type: 'text/csv' });

      const mockResponse = {
        jobs: [
          {
            id: 1,
            jobId: 'job1',
            templateId: 'template1',
            userId: 'user1',
            outputType: 'pdf' as const,
            status: 'succeeded' as const,
            filePath: 's3://bucket/outputs/file1.pdf',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };

      mock.onPost('/api/templates/template1/merge-csv').reply((config) => {
        expect(config.headers?.['Content-Type']).toBe('multipart/form-data');
        return [200, mockResponse];
      });

      const result = await mergeApi.mergeCsv('template1', mockCsvFile, 'pdf');

      expect(result).toEqual(mockResponse);
    });

    it('should download output', async () => {
      const mockBlob = new Blob(['output content'], { type: 'application/pdf' });

      mock.onGet('/api/download/outputs/file1.pdf').reply((config) => {
        expect(config.responseType).toBe('blob');
        return [200, mockBlob];
      });

      const result = await mergeApi.downloadOutput('outputs/file1.pdf');

      expect(result).toBeInstanceOf(Blob);
    });
  });

  describe('jobsApi', () => {
    it('should get all jobs', async () => {
      const mockJobs = [
        {
          id: 1,
          jobId: 'job1',
          templateId: 'template1',
          userId: 'user1',
          outputType: 'pdf' as const,
          status: 'succeeded' as const,
          filePath: 's3://bucket/outputs/file1.pdf',
          createdAt: '2024-01-01T00:00:00.000Z',
          template: {
            id: 'template1',
            name: 'Test Template',
          },
        },
      ];

      mock.onGet('/api/jobs').reply(200, mockJobs);

      const result = await jobsApi.getAll();

      expect(result).toEqual(mockJobs);
    });

    it('should delete a job', async () => {
      mock.onDelete('/api/jobs/1').reply(204);

      await expect(jobsApi.delete(1)).resolves.toBeUndefined();
    });

    it('should handle job deletion error', async () => {
      mock.onDelete('/api/jobs/1').reply(404, { error: 'Job not found' });

      await expect(jobsApi.delete(1)).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mock.onGet('/api/test').networkError();

      await expect(apiClient.get('/api/test')).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      mock.onGet('/api/test').timeout();

      await expect(apiClient.get('/api/test')).rejects.toThrow();
    });

    it('should handle 404 errors', async () => {
      mock.onGet('/api/test').reply(404, { error: 'Not found' });

      await expect(apiClient.get('/api/test')).rejects.toThrow();
    });

    it('should handle 500 errors', async () => {
      mock.onGet('/api/test').reply(500, { error: 'Internal server error' });

      await expect(apiClient.get('/api/test')).rejects.toThrow();
    });
  });
});
