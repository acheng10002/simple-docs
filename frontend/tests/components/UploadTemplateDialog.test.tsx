import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import UploadTemplateDialog from '../../src/components/UploadTemplateDialog';
import { templatesApi } from '../../src/api/client';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  templatesApi: {
    upload: vi.fn(),
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

describe('UploadTemplateDialog', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderDialog = (open = true) => {
    return render(
      <BrowserRouter>
        <UploadTemplateDialog open={open} onClose={mockOnClose} />
      </BrowserRouter>
    );
  };

  describe('Dialog rendering and visibility', () => {
    it('should render dialog when open prop is true', () => {
      renderDialog(true);
      expect(screen.getByText('Upload Template')).toBeInTheDocument();
      expect(screen.getByText(/drag and drop your template here/i)).toBeInTheDocument();
    });

    it('should not render dialog content when open prop is false', () => {
      renderDialog(false);
      expect(screen.queryByText('Upload Template')).not.toBeInTheDocument();
    });

    it('should display supported formats text', () => {
      renderDialog();
      expect(screen.getByText(/supported formats/i)).toBeInTheDocument();
      expect(screen.getByText(/\.docx, \.html, \.pdf, \.xlsx, \.pptx/i)).toBeInTheDocument();
    });

    it('should display cancel button', () => {
      renderDialog();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });

  describe('File selection via click', () => {
    it('should trigger file input when drop zone is clicked', () => {
      renderDialog();
      const dropZone = screen.getByText(/drag and drop/i).closest('div');
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      expect(fileInput).toBeInTheDocument();
      expect(fileInput).toHaveAttribute('accept', '.docx,.html,.pdf,.xlsx,.pptx');
    });

    it('should upload valid .docx file immediately', async () => {
      const mockResponse = { templateId: 'test-id-123', fields: [], message: 'Success' };
      vi.mocked(templatesApi.upload).mockResolvedValue(mockResponse);

      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(templatesApi.upload).toHaveBeenCalledWith(file);
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/templates/test-id-123/edit');
      });
    });

    it('should show error for invalid file type', async () => {
      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.txt', {
        type: 'text/plain',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/only \.docx, \.html, \.pdf, \.xlsx, and \.pptx files are supported/i)).toBeInTheDocument();
      });

      expect(templatesApi.upload).not.toHaveBeenCalled();
    });
  });

  describe('Drag-and-drop functionality', () => {
    const createDataTransfer = (files: File[]) => {
      return {
        files,
        items: files.map(file => ({
          kind: 'file',
          type: file.type,
          getAsFile: () => file,
        })),
        types: ['Files'],
      };
    };

    it('should handle valid file drop', async () => {
      const mockResponse = { templateId: 'test-id-456', fields: [], message: 'Success' };
      vi.mocked(templatesApi.upload).mockResolvedValue(mockResponse);

      renderDialog();
      const dropZone = screen.getByText(/drag and drop/i).closest('div') as HTMLElement;

      const file = new File(['content'], 'test.pdf', {
        type: 'application/pdf',
      });

      const dataTransfer = createDataTransfer([file]);

      fireEvent.dragOver(dropZone, { dataTransfer });
      fireEvent.drop(dropZone, { dataTransfer });

      await waitFor(() => {
        expect(templatesApi.upload).toHaveBeenCalledWith(file);
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/templates/test-id-456/edit');
      });
    });

    it('should show error when dropping multiple files', async () => {
      renderDialog();
      const dropZone = screen.getByText(/drag and drop/i).closest('div') as HTMLElement;

      const files = [
        new File(['content1'], 'test1.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        new File(['content2'], 'test2.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ];

      const dataTransfer = createDataTransfer(files);

      fireEvent.drop(dropZone, { dataTransfer });

      await waitFor(() => {
        expect(screen.getByText(/please upload only one file at a time/i)).toBeInTheDocument();
      });

      expect(templatesApi.upload).not.toHaveBeenCalled();
    });

    it('should show error for invalid file type on drop', async () => {
      renderDialog();
      const dropZone = screen.getByText(/drag and drop/i).closest('div') as HTMLElement;

      const file = new File(['content'], 'test.exe', {
        type: 'application/x-msdownload',
      });

      const dataTransfer = createDataTransfer([file]);

      fireEvent.drop(dropZone, { dataTransfer });

      await waitFor(() => {
        expect(screen.getByText(/only \.docx, \.html, \.pdf, \.xlsx, and \.pptx files are supported/i)).toBeInTheDocument();
      });

      expect(templatesApi.upload).not.toHaveBeenCalled();
    });
  });

  describe('Upload process', () => {
    it('should show loading state during upload', async () => {
      // Create a promise that we can control
      let resolveUpload: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        resolveUpload = resolve;
      });
      vi.mocked(templatesApi.upload).mockReturnValue(uploadPromise as any);

      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/uploading.../i)).toBeInTheDocument();
      });

      // Resolve the upload
      resolveUpload!({ templateId: 'test-id', fields: [], message: 'Success' });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });
    });

    it('should disable cancel button during upload', async () => {
      let resolveUpload: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        resolveUpload = resolve;
      });
      vi.mocked(templatesApi.upload).mockReturnValue(uploadPromise as any);

      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        const cancelButton = screen.getByRole('button', { name: /cancel/i });
        expect(cancelButton).toBeDisabled();
      });

      // Clean up
      resolveUpload!({ templateId: 'test-id', fields: [], message: 'Success' });
    });

    it('should display API error message on upload failure', async () => {
      vi.mocked(templatesApi.upload).mockRejectedValue({
        response: {
          data: {
            error: 'File size too large',
          },
        },
      });

      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('File size too large')).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should display generic error message on upload failure without specific error', async () => {
      vi.mocked(templatesApi.upload).mockRejectedValue(new Error('Network error'));

      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('Upload failed')).toBeInTheDocument();
      });
    });
  });

  describe('Dialog close behavior', () => {
    it('should call onClose when cancel button is clicked', () => {
      renderDialog();
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should not close dialog during upload', async () => {
      let resolveUpload: (value: any) => void;
      const uploadPromise = new Promise((resolve) => {
        resolveUpload = resolve;
      });
      vi.mocked(templatesApi.upload).mockReturnValue(uploadPromise as any);

      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/uploading.../i)).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).not.toHaveBeenCalled();

      // Clean up
      resolveUpload!({ templateId: 'test-id', fields: [], message: 'Success' });
    });

    it('should clear error when dialog closes', async () => {
      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.txt', {
        type: 'text/plain',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/only \.docx, \.html, \.pdf, \.xlsx, and \.pptx files are supported/i)).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should allow closing error alert', async () => {
      renderDialog();
      const fileInput = screen.getByRole('button', { name: /click to browse/i })
        .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

      const file = new File(['content'], 'test.txt', {
        type: 'text/plain',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/only \.docx, \.html, \.pdf, \.xlsx, and \.pptx files are supported/i)).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText(/only \.docx, \.html, \.pdf, \.xlsx, and \.pptx files are supported/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Supported file types', () => {
    const validFileTypes = [
      { name: 'test.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { name: 'test.html', type: 'text/html' },
      { name: 'test.pdf', type: 'application/pdf' },
      { name: 'test.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { name: 'test.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    ];

    validFileTypes.forEach(({ name, type }) => {
      it(`should accept ${name} file`, async () => {
        const mockResponse = { templateId: 'test-id', fields: [], message: 'Success' };
        vi.mocked(templatesApi.upload).mockResolvedValue(mockResponse);

        renderDialog();
        const fileInput = screen.getByRole('button', { name: /click to browse/i })
          .parentElement?.querySelector('input[type="file"]') as HTMLInputElement;

        const file = new File(['content'], name, { type });

        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
          expect(templatesApi.upload).toHaveBeenCalledWith(file);
        });
      });
    });
  });
});
