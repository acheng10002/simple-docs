import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import EditTemplate from '../../src/pages/EditTemplate';
import { SupabaseAuthProvider } from '../../src/context/SupabaseAuthContext';
import * as apiClient from '../../src/api/client';
import type { Template } from '../../src/types/api';

// Use vi.hoisted to create mocks
const { mockGetById, mockUpdate, mockDelete, mockGetVersions, mockRevertToVersion } = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockGetVersions: vi.fn(),
  mockRevertToVersion: vi.fn(),
}));

// Mock the API client
vi.mock('../../src/api/client', () => ({
  default: {
    post: vi.fn(),
  },
  templatesApi: {
    getById: mockGetById,
    update: mockUpdate,
    delete: mockDelete,
    getVersions: mockGetVersions,
    revertToVersion: mockRevertToVersion,
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

const mockTemplate: Template = {
  id: 'template-1',
  displayName: 'My Invoice Template.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  fields: [
    { id: 'field-1', name: 'customer_name' },
    { id: 'field-2', name: 'invoice_date' },
    { id: 'field-3', name: 'amount' },
  ],
  isActive: true,
  folderId: null,
  defaultOutputType: 'pdf',
  outputNameFormat: 'customer_name',
  pageSize: 'letter',
  orientation: 'portrait',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const renderEditTemplate = (templateId = 'template-1') => {
  return render(
    <MemoryRouter initialEntries={[`/templates/${templateId}/edit`]}>
      <SupabaseAuthProvider>
        <Routes>
          <Route path="/templates/:templateId/edit" element={<EditTemplate />} />
        </Routes>
      </SupabaseAuthProvider>
    </MemoryRouter>
  );
};

describe('EditTemplate Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    mockConfirm.mockClear();
    mockGetVersions.mockResolvedValue([]);
  });

  describe('Loading State', () => {
    it('should show loading spinner while fetching template', () => {
      mockGetById.mockImplementation(() => new Promise(() => {}));

      renderEditTemplate();

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error message when template not found', async () => {
      mockGetById.mockResolvedValue(null);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByText('Template not found')).toBeInTheDocument();
      });
    });

    it('should show error message when API fails', async () => {
      mockGetById.mockRejectedValue({
        response: { data: { error: 'Failed to load template' } },
      });

      renderEditTemplate();

      // When API fails and template is null, component shows "Template not found"
      await waitFor(() => {
        expect(screen.getByText('Template not found')).toBeInTheDocument();
      });
    });
  });

  describe('Form Display', () => {
    it('should display template name in header', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByText('Edit Template: My Invoice Template.docx')).toBeInTheDocument();
      });
    });

    it('should pre-fill form with template data', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        const nameInput = screen.getByLabelText(/template name/i);
        expect(nameInput).toHaveValue('My Invoice Template.docx');
      });
    });

    it('should display form with required fields', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      // Wait for form to load and check form exists
      await screen.findByLabelText(/template name/i);

      // Verify form element exists
      const form = document.querySelector('form');
      expect(form).toBeTruthy();
    });

    it('should display file replacement option', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      // Wait for form to fully load and check file input exists
      await screen.findByLabelText(/template name/i);

      // Check that file input exists for template replacement
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeTruthy();
    });
  });

  describe('Form Validation', () => {
    it('should not call API when template name is empty', async () => {
      // Create a template with empty displayName to test validation
      const emptyNameTemplate = { ...mockTemplate, displayName: '' };
      mockGetById.mockResolvedValue(emptyNameTemplate);

      renderEditTemplate();

      // Wait for form to load
      await screen.findByLabelText(/template name/i);

      // Submit the form
      const form = document.querySelector('form') as HTMLFormElement;
      fireEvent.submit(form);

      // API should not be called due to validation failure
      await waitFor(() => {
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe('Save Functionality', () => {
    it('should call update API with form data', async () => {
      mockGetById.mockResolvedValue(mockTemplate);
      mockUpdate.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      // Wait for form to load
      await screen.findByLabelText(/template name/i);

      // Submit the form (the original template name will be used)
      const form = document.querySelector('form') as HTMLFormElement;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('template-1', expect.objectContaining({
          displayName: 'My Invoice Template.docx',
        }));
      });
    });

    it('should show success message after successful save', async () => {
      mockGetById.mockResolvedValue(mockTemplate);
      mockUpdate.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      // Wait for form to load
      await screen.findByLabelText(/template name/i);

      // Submit the form
      const form = document.querySelector('form') as HTMLFormElement;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText(/template updated successfully/i)).toBeInTheDocument();
      });
    });

    it('should show saving state during API call', async () => {
      mockGetById.mockResolvedValue(mockTemplate);
      mockUpdate.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1000)));

      renderEditTemplate();

      // Wait for form to load
      await screen.findByLabelText(/template name/i);

      // Submit the form
      const form = document.querySelector('form') as HTMLFormElement;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText(/saving/i)).toBeInTheDocument();
      });
    });

    it('should show error message when save fails', async () => {
      mockGetById.mockResolvedValue(mockTemplate);
      mockUpdate.mockRejectedValue({
        response: { data: { error: 'Failed to update template' } },
      });

      renderEditTemplate();

      // Wait for form to load
      await screen.findByLabelText(/template name/i);

      // Submit the form
      const form = document.querySelector('form') as HTMLFormElement;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('Failed to update template')).toBeInTheDocument();
      });
    });
  });

  describe('File Replacement', () => {
    it('should display replace file button', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByText(/replace template file/i)).toBeInTheDocument();
      });
    });

    it('should show error for invalid file type', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByText(/replace template file/i)).toBeInTheDocument();
      });

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const invalidFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      fireEvent.change(fileInput, { target: { files: [invalidFile] } });

      await waitFor(() => {
        expect(screen.getByText(/only .docx, .html, .pdf, .xlsx, and .pptx files are supported/i)).toBeInTheDocument();
      });
    });

    it('should show selected file name when valid file is selected', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByText(/replace template file/i)).toBeInTheDocument();
      });

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const validFile = new File(['content'], 'new-template.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      fireEvent.change(fileInput, { target: { files: [validFile] } });

      await waitFor(() => {
        expect(screen.getByText(/selected: new-template.docx/i)).toBeInTheDocument();
      });
    });
  });

  describe('Deactivate Functionality', () => {
    it('should display deactivate button', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deactivate template/i })).toBeInTheDocument();
      });
    });

    it('should show confirmation dialog when deactivate is clicked', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deactivate template/i })).toBeInTheDocument();
      });

      const deactivateButton = screen.getByRole('button', { name: /deactivate template/i });
      fireEvent.click(deactivateButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should call delete API when deactivate is confirmed', async () => {
      mockGetById.mockResolvedValue(mockTemplate);
      mockDelete.mockResolvedValue(undefined);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deactivate template/i })).toBeInTheDocument();
      });

      const deactivateButton = screen.getByRole('button', { name: /deactivate template/i });
      fireEvent.click(deactivateButton);

      // Confirmation dialog should appear
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click Deactivate in the dialog — use getAllByRole since "Deactivate" text appears in both the page button and dialog button
      const deactivateButtons = screen.getAllByRole('button', { name: /deactivate/i });
      const confirmButton = deactivateButtons[deactivateButtons.length - 1];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('template-1');
        expect(mockNavigate).toHaveBeenCalledWith('/templates');
      });
    });

    it('should not call delete API when deactivate is cancelled', async () => {
      mockGetById.mockResolvedValue(mockTemplate);
      mockConfirm.mockReturnValue(false);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /deactivate template/i })).toBeInTheDocument();
      });

      const deactivateButton = screen.getByRole('button', { name: /deactivate template/i });
      fireEvent.click(deactivateButton);

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('Navigation', () => {
    it('should navigate back when cancel button is clicked', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockNavigate).toHaveBeenCalledWith('/templates');
    });

    it('should navigate back when back icon is clicked', async () => {
      mockGetById.mockResolvedValue(mockTemplate);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByTestId('ArrowBackIcon')).toBeInTheDocument();
      });

      const backIcon = screen.getByTestId('ArrowBackIcon');
      const backButton = backIcon.closest('button') as HTMLButtonElement;
      fireEvent.click(backButton);

      expect(mockNavigate).toHaveBeenCalledWith('/templates');
    });
  });

  describe('Version History Integration', () => {
    it('should display version history section', async () => {
      mockGetById.mockResolvedValue(mockTemplate);
      mockGetVersions.mockResolvedValue([]);

      renderEditTemplate();

      await waitFor(() => {
        expect(screen.getByText('Version History')).toBeInTheDocument();
      });
    });
  });
});
