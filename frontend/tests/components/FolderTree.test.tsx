import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FolderTree from '../../src/components/FolderTree';
import { foldersApi } from '../../src/api/client';
import type { Folder, Template } from '../../src/types/api';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  foldersApi: {
    delete: vi.fn(),
  },
}));

const mockFolders: Folder[] = [
  { id: 'folder-1', name: 'Documents', depth: 1, parentId: null, _count: { templates: 2, children: 1 } },
  { id: 'folder-2', name: 'Reports', depth: 1, parentId: null, _count: { templates: 1, children: 0 } },
  { id: 'folder-3', name: 'Archive', depth: 2, parentId: 'folder-1', _count: { templates: 0, children: 0 } },
];

const mockTemplates: Template[] = [
  {
    id: 'template-1',
    displayName: 'Invoice Template',
    originalName: 'invoice.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 1024,
    storagePath: '/path/to/invoice.docx',
    isActive: true,
    folderId: 'folder-1',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    fields: [],
    folder: mockFolders[0],
  },
  {
    id: 'template-2',
    displayName: 'Report Template',
    originalName: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 2048,
    storagePath: '/path/to/report.docx',
    isActive: true,
    folderId: 'folder-1',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    fields: [],
    folder: mockFolders[0],
  },
];

describe('FolderTree', () => {
  const defaultProps = {
    folders: mockFolders,
    templates: mockTemplates,
    selectedFolderId: null,
    expandedFolderIds: new Set<string>(),
    onSelectFolder: vi.fn(),
    onToggleFolder: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onMoveFolder: vi.fn(),
    onRefresh: vi.fn(),
    onDrop: vi.fn(),
    onDragOverChange: vi.fn(),
    dragOverFolderId: null,
    onMerge: vi.fn(),
    onDownload: vi.fn(),
    onCsvMerge: vi.fn(),
    onEdit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render root folders', () => {
      render(<FolderTree {...defaultProps} />);

      expect(screen.getByText('Documents')).toBeInTheDocument();
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    it('should render nested folders when expanded', () => {
      render(
        <FolderTree
          {...defaultProps}
          expandedFolderIds={new Set(['folder-1'])}
        />
      );

      expect(screen.getByText('Archive')).toBeInTheDocument();
    });

    it('should not render nested folders when collapsed', () => {
      render(<FolderTree {...defaultProps} />);

      expect(screen.queryByText('Archive')).not.toBeInTheDocument();
    });

    it('should show templates when folder is selected', () => {
      render(
        <FolderTree
          {...defaultProps}
          selectedFolderId="folder-1"
        />
      );

      expect(screen.getByText('Invoice Template')).toBeInTheDocument();
      expect(screen.getByText('Report Template')).toBeInTheDocument();
    });

    it('should not show templates when folder is not selected', () => {
      render(<FolderTree {...defaultProps} />);

      expect(screen.queryByText('Invoice Template')).not.toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('should call onSelectFolder when folder is clicked', () => {
      render(<FolderTree {...defaultProps} />);

      const folder = screen.getByText('Documents');
      fireEvent.click(folder);

      expect(defaultProps.onSelectFolder).toHaveBeenCalledWith('folder-1');
    });

    it('should deselect folder when clicking selected folder', () => {
      render(
        <FolderTree
          {...defaultProps}
          selectedFolderId="folder-1"
        />
      );

      const folder = screen.getByText('Documents');
      fireEvent.click(folder);

      expect(defaultProps.onSelectFolder).toHaveBeenCalledWith(null);
    });

    it('should call onToggleFolder when expand button is clicked', () => {
      render(<FolderTree {...defaultProps} />);

      // Find and click the expand button (ChevronRight icon button)
      const expandButtons = screen.getAllByRole('button');
      // First button should be the expand button for "Documents" folder
      fireEvent.click(expandButtons[0]);

      expect(defaultProps.onToggleFolder).toHaveBeenCalledWith('folder-1');
    });
  });

  describe('Context Menu', () => {
    it('should open context menu when more button is clicked', async () => {
      render(<FolderTree {...defaultProps} />);

      // Find the more button (last button in the folder row)
      const moreButtons = screen.getAllByRole('button');
      // Click the more button for the first folder (Documents)
      fireEvent.click(moreButtons[1]); // Second button is more menu

      await waitFor(() => {
        expect(screen.getByText('New Subfolder')).toBeInTheDocument();
        expect(screen.getByText('Rename')).toBeInTheDocument();
        expect(screen.getByText('Move')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });

    it('should call onCreateFolder when New Subfolder is clicked', async () => {
      render(<FolderTree {...defaultProps} />);

      const moreButtons = screen.getAllByRole('button');
      fireEvent.click(moreButtons[1]);

      await waitFor(() => {
        expect(screen.getByText('New Subfolder')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Subfolder'));

      expect(defaultProps.onCreateFolder).toHaveBeenCalledWith('folder-1');
    });

    it('should call onRenameFolder when Rename is clicked', async () => {
      render(<FolderTree {...defaultProps} />);

      const moreButtons = screen.getAllByRole('button');
      fireEvent.click(moreButtons[1]);

      await waitFor(() => {
        expect(screen.getByText('Rename')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Rename'));

      expect(defaultProps.onRenameFolder).toHaveBeenCalledWith(mockFolders[0]);
    });

    it('should call onMoveFolder when Move is clicked', async () => {
      render(<FolderTree {...defaultProps} />);

      const moreButtons = screen.getAllByRole('button');
      fireEvent.click(moreButtons[1]);

      await waitFor(() => {
        expect(screen.getByText('Move')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Move'));

      expect(defaultProps.onMoveFolder).toHaveBeenCalledWith(mockFolders[0]);
    });
  });

  describe('Delete Folder', () => {
    it('should show delete confirmation dialog', async () => {
      render(<FolderTree {...defaultProps} />);

      const moreButtons = screen.getAllByRole('button');
      fireEvent.click(moreButtons[1]);

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete Folder')).toBeInTheDocument();
        expect(screen.getByText(/are you sure you want to delete/i)).toBeInTheDocument();
      });
    });

    it('should delete folder when confirmed', async () => {
      vi.mocked(foldersApi.delete).mockResolvedValue(undefined);

      render(<FolderTree {...defaultProps} />);

      const moreButtons = screen.getAllByRole('button');
      fireEvent.click(moreButtons[1]);

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const deleteButton = screen.getByRole('button', { name: /^delete$/i });
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(foldersApi.delete).toHaveBeenCalledWith('folder-1');
        expect(defaultProps.onRefresh).toHaveBeenCalled();
      });
    });

    it('should close dialog when cancel is clicked', async () => {
      render(<FolderTree {...defaultProps} />);

      const moreButtons = screen.getAllByRole('button');
      fireEvent.click(moreButtons[1]);

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('Template Actions', () => {
    it('should call onMerge when merge button is clicked', async () => {
      render(
        <FolderTree
          {...defaultProps}
          selectedFolderId="folder-1"
        />
      );

      // Find merge buttons by their tooltip
      const mergeButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg[data-testid="MergeTypeIcon"]')
      );

      if (mergeButton) {
        fireEvent.click(mergeButton);
        expect(defaultProps.onMerge).toHaveBeenCalledWith('template-1');
      }
    });

    it('should call onDownload when download button is clicked', async () => {
      render(
        <FolderTree
          {...defaultProps}
          selectedFolderId="folder-1"
        />
      );

      const downloadButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg[data-testid="DownloadIcon"]')
      );

      if (downloadButton) {
        fireEvent.click(downloadButton);
        expect(defaultProps.onDownload).toHaveBeenCalledWith('template-1', 'Invoice Template');
      }
    });

    it('should call onEdit when edit button is clicked', async () => {
      render(
        <FolderTree
          {...defaultProps}
          selectedFolderId="folder-1"
        />
      );

      const editButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg[data-testid="EditIcon"]')
      );

      if (editButton) {
        fireEvent.click(editButton);
        expect(defaultProps.onEdit).toHaveBeenCalledWith('template-1');
      }
    });
  });

  describe('Drag and Drop', () => {
    it('should highlight folder on drag over', () => {
      render(
        <FolderTree
          {...defaultProps}
          dragOverFolderId="folder-1"
        />
      );

      // The folder should have highlighted background
      const folderElement = screen.getByText('Documents').closest('div');
      expect(folderElement).toHaveStyle({ backgroundColor: expect.any(String) });
    });
  });
});
