import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Outputs from '../../src/pages/Outputs';
import { SupabaseAuthProvider } from '../../src/context/SupabaseAuthContext';
import * as apiClient from '../../src/api/client';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  default: {
    post: vi.fn(),
  },
  jobsApi: {
    getAll: vi.fn(),
    delete: vi.fn(),
  },
  mergeApi: {
    downloadOutput: vi.fn(),
  },
}));

// Mock Supabase
vi.mock('../../src/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      setSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock window.confirm
const mockConfirm = vi.fn();
global.confirm = mockConfirm;

// Mock URL.createObjectURL and revokeObjectURL
const mockObjectURL = 'blob:mock-url';
global.URL.createObjectURL = vi.fn(() => mockObjectURL);
global.URL.revokeObjectURL = vi.fn();

const renderOutputs = () => {
  return render(
    <BrowserRouter>
      <SupabaseAuthProvider>
        <Outputs />
      </SupabaseAuthProvider>
    </BrowserRouter>
  );
};

describe('Outputs Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    mockConfirm.mockClear();
  });

  it('should render outputs page header', async () => {
    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue([]);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('MergeMyDocs - Merge Outputs')).toBeInTheDocument();
      expect(screen.getByText('Merge Outputs')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /templates/i })).toBeInTheDocument();
    });
  });

  it('should display loading state', () => {
    vi.mocked(apiClient.jobsApi.getAll).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading
    );

    renderOutputs();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should display empty state when no outputs', async () => {
    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue([]);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText(/no merge outputs yet/i)).toBeInTheDocument();
      expect(screen.getByText(/merge a template to see results here/i)).toBeInTheDocument();
    });
  });

  it('should display merge outputs list', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template 1',
        },
      },
      {
        id: 2,
        jobId: 'job2',
        templateId: 'template2',
        userId: 'user1',
        outputType: 'docx',
        status: 'processing',
        filePath: 's3://bucket/outputs/file2.docx',
        createdAt: '2024-01-02T12:00:00.000Z',
        template: {
          id: 'template2',
          displayName: 'Test Template 2',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Test Template 1')).toBeInTheDocument();
      expect(screen.getByText('Test Template 2')).toBeInTheDocument();
      expect(screen.getByText('succeeded')).toBeInTheDocument();
      expect(screen.getByText('processing')).toBeInTheDocument();
    });
  });

  it('should handle unknown template name', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: undefined,
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  it('should display status chip with correct color', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);

    renderOutputs();

    await waitFor(() => {
      const statusChip = screen.getByText('succeeded').closest('.MuiChip-root');
      // Succeeded status uses inline green styles
      expect(statusChip).toHaveStyle({ backgroundColor: '#4caf50' });
    });
  });

  it('should handle download output', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    const mockBlob = new Blob(['test content'], { type: 'application/pdf' });

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.mergeApi.downloadOutput).mockResolvedValue(mockBlob);

    // Mock document.body.appendChild and removeChild
    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');
    const clickSpy = vi.fn();

    // Mock createElement to return an element with a click method
    const originalCreateElement = document.createElement;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement.call(document, tagName);
      if (tagName === 'a') {
        element.click = clickSpy;
      }
      return element;
    });

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const downloadIcon = screen.getByTestId('DownloadIcon');
    const downloadButton = downloadIcon.closest('button') as HTMLButtonElement;
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(apiClient.mergeApi.downloadOutput).toHaveBeenCalledWith('outputs/file1.pdf');
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(clickSpy).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(mockObjectURL);
    });

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('should disable download button for failed jobs', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'failed',
        filePath: 's3://bucket/outputs/file1.pdf',
        error: 'Merge failed',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const downloadIcon = screen.getByTestId('DownloadIcon');
    const downloadButton = downloadIcon.closest('button') as HTMLButtonElement;
    expect(downloadButton).toBeDisabled();
  });

  it('should handle delete output with confirmation', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.jobsApi.delete).mockResolvedValue(undefined);
    mockConfirm.mockReturnValue(true);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const deleteIcon = screen.getByTestId('DeleteIcon');
    const deleteButton = deleteIcon.closest('button') as HTMLButtonElement;
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.stringContaining('Are you sure you want to delete this merge output from "Test Template"?')
      );
      expect(apiClient.jobsApi.delete).toHaveBeenCalledWith(1);
      expect(apiClient.jobsApi.getAll).toHaveBeenCalledTimes(2); // Initial load + reload after delete
    });
  });

  it('should not delete output if confirmation is cancelled', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);
    mockConfirm.mockReturnValue(false);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const deleteIcon = screen.getByTestId('DeleteIcon');
    const deleteButton = deleteIcon.closest('button') as HTMLButtonElement;
    fireEvent.click(deleteButton);

    expect(mockConfirm).toHaveBeenCalled();
    expect(apiClient.jobsApi.delete).not.toHaveBeenCalled();
  });

  it('should display error message on API failure', async () => {
    const errorMessage = 'Failed to load merge outputs';
    vi.mocked(apiClient.jobsApi.getAll).mockRejectedValue({
      response: { data: { error: errorMessage } },
    });

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('should display error message on download failure', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.mergeApi.downloadOutput).mockRejectedValue({
      response: { data: { error: 'Download failed' } },
    });

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const downloadIcon = screen.getByTestId('DownloadIcon');
    const downloadButton = downloadIcon.closest('button') as HTMLButtonElement;
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(screen.getByText('Download failed')).toBeInTheDocument();
    });
  });

  it('should display error message on delete failure', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-01T12:00:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);
    vi.mocked(apiClient.jobsApi.delete).mockRejectedValue({
      response: { data: { error: 'Delete failed' } },
    });
    mockConfirm.mockReturnValue(true);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const deleteIcon = screen.getByTestId('DeleteIcon');
    const deleteButton = deleteIcon.closest('button') as HTMLButtonElement;
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('should navigate to templates page when templates button clicked', async () => {
    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue([]);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /templates/i })).toBeInTheDocument();
    });

    const templatesButton = screen.getByRole('button', { name: /templates/i });
    fireEvent.click(templatesButton);

    expect(mockNavigate).toHaveBeenCalledWith('/templates');
  });

  it('should handle logout', async () => {
    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue([]);

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
    });

    const logoutButton = screen.getByRole('button', { name: /log out/i });
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  it('should format dates correctly', async () => {
    const mockJobs = [
      {
        id: 1,
        jobId: 'job1',
        templateId: 'template1',
        userId: 'user1',
        outputType: 'pdf',
        status: 'succeeded',
        filePath: 's3://bucket/outputs/file1.pdf',
        createdAt: '2024-01-15T10:30:00.000Z',
        template: {
          id: 'template1',
          displayName: 'Test Template',
        },
      },
    ];

    vi.mocked(apiClient.jobsApi.getAll).mockResolvedValue(mockJobs);

    renderOutputs();

    await waitFor(() => {
      const dateCell = screen.getByText(/1\/15\/2024/);
      expect(dateCell).toBeInTheDocument();
    });
  });

  it('should close error alert when close button clicked', async () => {
    const errorMessage = 'Test error message';
    vi.mocked(apiClient.jobsApi.getAll).mockRejectedValue({
      response: { data: { error: errorMessage } },
    });

    renderOutputs();

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText(errorMessage)).not.toBeInTheDocument();
    });
  });
});
