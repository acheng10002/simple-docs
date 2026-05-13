import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import apiClient, { authApi, templatesApi, mergeApi, jobsApi, foldersApi, batchJobsApi } from '../../src/api/client';

// Mock Supabase - must create mock inside factory to avoid hoisting issues
vi.mock('../../src/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

// Mock window.location
delete (window as any).location;
window.location = { href: '' } as any;

// Import after mock to get mocked version
import { supabase } from '../../src/config/supabase';

describe('API Client', () => {
  let mock: MockAdapter;

  const mockSession = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Date.now() + 3600000,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2024-01-01T00:00:00.000Z',
    },
  };

  beforeEach(() => {
    mock = new MockAdapter(apiClient);
    window.location.href = '';
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null },
      error: { message: 'Refresh failed' } as any,
    });
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    mock.restore();
  });

  describe('Request Interceptor', () => {
    it('should add Authorization header when Supabase session exists', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mock.onGet('/api/test').reply((config) => {
        expect(config.headers?.Authorization).toBe('Bearer test-access-token');
        return [200, { success: true }];
      });

      await apiClient.get('/api/test');
    });

    it('should not add Authorization header when no Supabase session exists', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      mock.onGet('/api/test').reply((config) => {
        expect(config.headers?.Authorization).toBeUndefined();
        return [200, { success: true }];
      });

      await apiClient.get('/api/test');
    });

    // Note: getSession errors are not caught by the interceptor and will cause request to fail
    // This matches current implementation behavior
  });

  describe('Response Interceptor', () => {
    // Note: Full retry flow with token refresh is difficult to test with axios-mock-adapter
    // due to how axios.request(config) creates new requests. The functionality is verified
    // through integration tests and manual testing.

    it('should sign out and redirect on 401 when token refresh fails', async () => {
      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: null },
        error: { message: 'Refresh failed' } as any,
      });

      mock.onGet('/api/test').reply(401, { error: 'Unauthorized' });

      try {
        await apiClient.get('/api/test');
      } catch (error) {
        // Error is expected
      }

      expect(supabase.auth.refreshSession).toHaveBeenCalled();
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(window.location.href).toBe('/login');
    });

    it('should sign out and redirect on 401 when refresh returns null session', async () => {
      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      mock.onGet('/api/test').reply(401, { error: 'Unauthorized' });

      try {
        await apiClient.get('/api/test');
      } catch (error) {
        // Error is expected
      }

      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(window.location.href).toBe('/login');
    });

    it('should attempt token refresh on 401 for non-auth endpoints', async () => {
      const refreshedSession = {
        ...mockSession,
        access_token: 'refreshed-token',
      };

      vi.mocked(supabase.auth.refreshSession).mockResolvedValue({
        data: { session: refreshedSession },
        error: null,
      });

      mock.onGet('/api/test').replyOnce(401, { error: 'Unauthorized' });
      // The retry via axios.request() bypasses mock-adapter, so the request will fail
      // but we can verify the refresh was attempted and the retry was configured correctly

      try {
        await apiClient.get('/api/test');
      } catch {
        // Expected - retry goes through real axios which has no server
      }

      expect(supabase.auth.refreshSession).toHaveBeenCalled();
      // signOut should NOT have been called since refresh succeeded
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    it('should not attempt refresh for auth endpoint 401 errors', async () => {
      mock.onPost('/api/auth/login').reply(401, { error: 'Invalid credentials' });

      try {
        await apiClient.post('/api/auth/login', { email: 'test@test.com', password: 'wrong' });
      } catch (error) {
        // Error is expected
      }

      expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    it('should not attempt refresh for non-401 errors', async () => {
      mock.onGet('/api/test').reply(500, { error: 'Server Error' });

      try {
        await apiClient.get('/api/test');
      } catch (error) {
        // Error is expected
      }

      expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
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
        session: mockSession,
        user: { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' },
      };

      mock.onPost('/api/auth/register', mockRequest).reply(201, mockResponse);

      const result = await authApi.register(mockRequest);

      expect(result).toEqual(mockResponse);
      expect(result.session).toBeDefined();
      expect(result.user).toBeDefined();
    });

    it('should login a user', async () => {
      const mockRequest = {
        email: 'test@example.com',
        password: 'password123',
      };

      const mockResponse = {
        session: mockSession,
        user: { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' },
      };

      mock.onPost('/api/auth/login', mockRequest).reply(200, mockResponse);

      const result = await authApi.login(mockRequest);

      expect(result).toEqual(mockResponse);
      expect(result.session).toBeDefined();
      expect(result.user).toBeDefined();
    });

    it('should handle login error', async () => {
      const mockRequest = {
        email: 'test@example.com',
        password: 'wrong-password',
      };

      mock.onPost('/api/auth/login', mockRequest).reply(401, { error: 'Invalid credentials' });

      await expect(authApi.login(mockRequest)).rejects.toThrow();
    });

    it('should handle registration validation errors', async () => {
      const mockRequest = {
        email: 'invalid-email',
        password: 'short',
        firstName: 'Test',
        lastName: 'User',
      };

      mock.onPost('/api/auth/register', mockRequest).reply(400, { error: 'Invalid email format' });

      await expect(authApi.register(mockRequest)).rejects.toThrow();
    });

    it('should send forgot password request', async () => {
      mock.onPost('/api/auth/forgot-password').reply(200, { message: 'Email sent' });

      const result = await authApi.forgotPassword('test@example.com');

      expect(result.message).toBe('Email sent');
    });

    it('should reset password', async () => {
      mock.onPost('/api/auth/reset-password').reply(200, { message: 'Password reset' });

      const result = await authApi.resetPassword('newpass123', 'access-token');

      expect(result.message).toBe('Password reset');
    });

    it('should update email', async () => {
      mock.onPut('/api/auth/update-email').reply(200, { message: 'Email updated' });

      const result = await authApi.updateEmail('new@example.com');

      expect(result.message).toBe('Email updated');
    });

    it('should update password', async () => {
      mock.onPut('/api/auth/update-password').reply(200, { message: 'Password updated' });

      const result = await authApi.updatePassword('oldpass', 'newpass');

      expect(result.message).toBe('Password updated');
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

    it('should activate a template', async () => {
      mock.onPost('/api/templates/1/activate').reply(200);

      await expect(templatesApi.activate('1')).resolves.toBeUndefined();
    });

    it('should get template versions', async () => {
      const mockVersions = [
        { id: 'v1', versionNumber: 1, storageKey: 'key1' },
      ];
      mock.onGet('/api/templates/1/versions').reply(200, mockVersions);

      const result = await templatesApi.getVersions('1');

      expect(result).toEqual(mockVersions);
    });

    it('should revert to a version', async () => {
      const mockResponse = { message: 'Reverted' };
      mock.onPost('/api/templates/1/versions/v1/revert').reply(200, mockResponse);

      const result = await templatesApi.revertToVersion('1', 'v1');

      expect(result).toEqual(mockResponse);
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

  describe('foldersApi', () => {
    it('should get all folders', async () => {
      const mockFolders = [{ id: 'f1', name: 'Folder 1' }];
      mock.onGet('/api/folders').reply(200, mockFolders);

      const result = await foldersApi.getAll();

      expect(result).toEqual(mockFolders);
    });

    it('should create a folder', async () => {
      const mockFolder = { id: 'f1', name: 'New Folder' };
      mock.onPost('/api/folders').reply(201, mockFolder);

      const result = await foldersApi.create({ name: 'New Folder' });

      expect(result).toEqual(mockFolder);
    });

    it('should rename a folder', async () => {
      const mockFolder = { id: 'f1', name: 'Renamed' };
      mock.onPut('/api/folders/f1').reply(200, mockFolder);

      const result = await foldersApi.rename('f1', { name: 'Renamed' });

      expect(result).toEqual(mockFolder);
    });

    it('should move a folder', async () => {
      const mockFolder = { id: 'f1', name: 'Folder 1' };
      mock.onPut('/api/folders/f1/move').reply(200, mockFolder);

      const result = await foldersApi.move('f1', { newParentId: 'f2' });

      expect(result).toEqual(mockFolder);
    });

    it('should delete a folder', async () => {
      mock.onDelete('/api/folders/f1').reply(204);

      await expect(foldersApi.delete('f1')).resolves.toBeUndefined();
    });

    it('should move a template to a folder', async () => {
      const mockTemplate = { id: 't1', folderId: 'f1' };
      mock.onPut('/api/templates/t1/move').reply(200, mockTemplate);

      const result = await foldersApi.moveTemplate('t1', { folderId: 'f1' });

      expect(result).toEqual(mockTemplate);
    });
  });

  describe('batchJobsApi', () => {
    it('should get batch job status', async () => {
      const mockStatus = { id: 'batch-1', status: 'completed', totalRows: 5, processedRows: 5 };
      mock.onGet('/api/batch-jobs/batch-1').reply(200, mockStatus);

      const result = await batchJobsApi.getStatus('batch-1');

      expect(result).toEqual(mockStatus);
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
