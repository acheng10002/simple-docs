import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Templates from '../../src/pages/Templates';
import { AuthProvider } from '../../src/context/AuthContext';
import * as apiClient from '../../src/api/client';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  templatesApi: {
    getAll: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    delete: vi.fn(),
  },
  mergeApi: {
    mergeCsv: vi.fn(),
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

const renderTemplates = () => {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <Templates />
      </AuthProvider>
    </BrowserRouter>
  );
};

describe('Templates Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    mockConfirm.mockClear();
  });

  it('should render templates page header', async () => {
    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue([]);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('MergeMyDocs - Templates')).toBeInTheDocument();
      expect(screen.getByText('My Templates')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /upload template/i })).toBeInTheDocument();
    });
  });

  it('should display loading state', () => {
    vi.mocked(apiClient.templatesApi.getAll).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading
    );

    renderTemplates();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should display empty state when no templates', async () => {
    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue([]);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
      expect(screen.getByText(/upload your first template/i)).toBeInTheDocument();
    });
  });

  it('should display templates list', async () => {
    const mockTemplates = [
      {
        id: '1',
        name: 'Test Template 1',
        fields: [
          { id: '1', name: 'field1', templateId: '1' },
          { id: '2', name: 'field2', templateId: '1' },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      },
      {
        id: '2',
        name: 'Test Template 2',
        fields: [
          { id: '3', name: 'field3', templateId: '2' },
        ],
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        uploadedById: 'user1',
      },
    ];

    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue(mockTemplates);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('Test Template 1')).toBeInTheDocument();
      expect(screen.getByText('Test Template 2')).toBeInTheDocument();
      expect(screen.getByText('field1, field2')).toBeInTheDocument();
      expect(screen.getByText('field3')).toBeInTheDocument();
    });
  });

  it('should open upload dialog when upload button is clicked', async () => {
    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue([]);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /upload template/i })).toBeInTheDocument();
    });

    const uploadButton = screen.getByRole('button', { name: /upload template/i });
    fireEvent.click(uploadButton);

    await waitFor(() => {
      expect(screen.getByText(/drag and drop your template here/i)).toBeInTheDocument();
    });
  });

  it('should navigate to merge page when merge button clicked', async () => {
    const mockTemplates = [
      {
        id: 'template1',
        name: 'Test Template',
        fields: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      },
    ];

    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue(mockTemplates);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const mergeButton = screen.getByTitle('Merge');
    fireEvent.click(mergeButton);

    expect(mockNavigate).toHaveBeenCalledWith('/templates/template1/merge');
  });

  it('should handle CSV merge and navigate to outputs', async () => {
    const mockTemplates = [
      {
        id: 'template1',
        name: 'Test Template',
        fields: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      },
    ];

    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue(mockTemplates);
    vi.mocked(apiClient.mergeApi.mergeCsv).mockResolvedValue({ jobs: [] });

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const csvButton = screen.getByTitle('Bulk Merge CSV');
    const fileInput = csvButton.querySelector('input[type="file"]') as HTMLInputElement;

    const csvFile = new File(['col1,col2\nval1,val2'], 'test.csv', { type: 'text/csv' });

    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    await waitFor(() => {
      expect(apiClient.mergeApi.mergeCsv).toHaveBeenCalledWith('template1', csvFile, 'pdf');
      expect(mockNavigate).toHaveBeenCalledWith('/outputs');
    });
  });

  it('should show error for invalid CSV file', async () => {
    const mockTemplates = [
      {
        id: 'template1',
        name: 'Test Template',
        fields: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      },
    ];

    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue(mockTemplates);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const csvButton = screen.getByTitle('Bulk Merge CSV');
    const fileInput = csvButton.querySelector('input[type="file"]') as HTMLInputElement;

    const txtFile = new File(['content'], 'test.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [txtFile] } });

    await waitFor(() => {
      expect(screen.getByText(/only csv files are supported for bulk merge/i)).toBeInTheDocument();
    });

    expect(apiClient.mergeApi.mergeCsv).not.toHaveBeenCalled();
  });

  it('should handle template download', async () => {
    const mockTemplates = [
      {
        id: 'template1',
        name: 'Test Template.docx',
        fields: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      },
    ];

    const mockBlob = new Blob(['test content'], { type: 'application/octet-stream' });

    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue(mockTemplates);
    vi.mocked(apiClient.templatesApi.download).mockResolvedValue(mockBlob);

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

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('Test Template.docx')).toBeInTheDocument();
    });

    const downloadButton = screen.getByTitle('Download');
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(apiClient.templatesApi.download).toHaveBeenCalledWith('template1');
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(clickSpy).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith(mockObjectURL);
    });

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('should handle template deactivation with confirmation', async () => {
    const mockTemplates = [
      {
        id: 'template1',
        name: 'Test Template',
        fields: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      },
    ];

    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue(mockTemplates);
    vi.mocked(apiClient.templatesApi.delete).mockResolvedValue(undefined);
    mockConfirm.mockReturnValue(true);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const deactivateButton = screen.getByTitle('Deactivate');
    fireEvent.click(deactivateButton);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.stringContaining('Are you sure you want to deactivate the template "Test Template"?')
      );
      expect(apiClient.templatesApi.delete).toHaveBeenCalledWith('template1');
      expect(apiClient.templatesApi.getAll).toHaveBeenCalledTimes(2); // Initial load + reload after deactivate
    });
  });

  it('should not deactivate template if confirmation is cancelled', async () => {
    const mockTemplates = [
      {
        id: 'template1',
        name: 'Test Template',
        fields: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        uploadedById: 'user1',
      },
    ];

    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue(mockTemplates);
    mockConfirm.mockReturnValue(false);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText('Test Template')).toBeInTheDocument();
    });

    const deactivateButton = screen.getByTitle('Deactivate');
    fireEvent.click(deactivateButton);

    expect(mockConfirm).toHaveBeenCalled();
    expect(apiClient.templatesApi.delete).not.toHaveBeenCalled();
  });

  it('should display error message on API failure', async () => {
    const errorMessage = 'Failed to load templates';
    vi.mocked(apiClient.templatesApi.getAll).mockRejectedValue({
      response: { data: { error: errorMessage } },
    });

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('should navigate to outputs page when outputs button clicked', async () => {
    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue([]);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /outputs/i })).toBeInTheDocument();
    });

    const outputsButton = screen.getByRole('button', { name: /outputs/i });
    fireEvent.click(outputsButton);

    expect(mockNavigate).toHaveBeenCalledWith('/outputs');
  });

  it('should handle logout', async () => {
    vi.mocked(apiClient.templatesApi.getAll).mockResolvedValue([]);

    renderTemplates();

    await waitFor(() => {
      expect(screen.getByTestId('LogoutIcon')).toBeInTheDocument();
    });

    const logoutButton = screen.getByTestId('LogoutIcon').closest('button') as HTMLButtonElement;
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });
});
