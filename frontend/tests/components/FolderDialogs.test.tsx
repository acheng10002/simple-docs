import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CreateFolderDialog,
  RenameFolderDialog,
  MoveFolderDialog,
  MoveTemplateDialog,
} from '../../src/components/FolderDialogs';
import { foldersApi } from '../../src/api/client';
import type { Folder } from '../../src/types/api';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  foldersApi: {
    create: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    moveTemplate: vi.fn(),
  },
}));

const mockFolders: Folder[] = [
  { id: 'folder-1', name: 'Documents', depth: 1, parentId: null, _count: { templates: 5, children: 1 } },
  { id: 'folder-2', name: 'Reports', depth: 1, parentId: null, _count: { templates: 3, children: 0 } },
  { id: 'folder-3', name: 'Archive', depth: 2, parentId: 'folder-1', _count: { templates: 2, children: 0 } },
];

describe('CreateFolderDialog', () => {
  const defaultProps = {
    open: true,
    parentId: null,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render create folder dialog', () => {
    render(<CreateFolderDialog {...defaultProps} />);

    expect(screen.getByText('Create New Folder')).toBeInTheDocument();
    expect(screen.getByLabelText(/folder name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('should show error when folder name is empty', async () => {
    render(<CreateFolderDialog {...defaultProps} />);

    const createButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByText(/folder name is required/i)).toBeInTheDocument();
    });

    expect(foldersApi.create).not.toHaveBeenCalled();
  });

  it('should call create API with correct params', async () => {
    vi.mocked(foldersApi.create).mockResolvedValue(mockFolders[0]);

    render(<CreateFolderDialog {...defaultProps} parentId="parent-1" />);

    const input = screen.getByLabelText(/folder name/i);
    const createButton = screen.getByRole('button', { name: /create/i });

    fireEvent.change(input, { target: { value: 'New Folder' } });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(foldersApi.create).toHaveBeenCalledWith({
        name: 'New Folder',
        parentId: 'parent-1',
      });
      expect(defaultProps.onSuccess).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('should show error message on API failure', async () => {
    vi.mocked(foldersApi.create).mockRejectedValue({
      response: { data: { error: 'Folder already exists' } },
    });

    render(<CreateFolderDialog {...defaultProps} />);

    const input = screen.getByLabelText(/folder name/i);
    const createButton = screen.getByRole('button', { name: /create/i });

    fireEvent.change(input, { target: { value: 'Duplicate' } });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByText('Folder already exists')).toBeInTheDocument();
    });
  });

  it('should close dialog when cancel is clicked', () => {
    render(<CreateFolderDialog {...defaultProps} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});

describe('RenameFolderDialog', () => {
  const defaultProps = {
    open: true,
    folder: mockFolders[0],
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render rename dialog with current folder name', () => {
    render(<RenameFolderDialog {...defaultProps} />);

    expect(screen.getByText('Rename Folder')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Documents')).toBeInTheDocument();
  });

  it('should call rename API with correct params', async () => {
    vi.mocked(foldersApi.rename).mockResolvedValue(mockFolders[0]);

    render(<RenameFolderDialog {...defaultProps} />);

    const input = screen.getByLabelText(/folder name/i);
    const renameButton = screen.getByRole('button', { name: /rename/i });

    fireEvent.change(input, { target: { value: 'Renamed Folder' } });
    fireEvent.click(renameButton);

    await waitFor(() => {
      expect(foldersApi.rename).toHaveBeenCalledWith('folder-1', {
        name: 'Renamed Folder',
      });
      expect(defaultProps.onSuccess).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('should show error when name is empty', async () => {
    render(<RenameFolderDialog {...defaultProps} />);

    const input = screen.getByLabelText(/folder name/i);
    const renameButton = screen.getByRole('button', { name: /rename/i });

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(renameButton);

    await waitFor(() => {
      expect(screen.getByText(/folder name is required/i)).toBeInTheDocument();
    });
  });

  it('should show error on API failure', async () => {
    vi.mocked(foldersApi.rename).mockRejectedValue({
      response: { data: { error: 'Name already exists' } },
    });

    render(<RenameFolderDialog {...defaultProps} />);

    const renameButton = screen.getByRole('button', { name: /rename/i });
    fireEvent.click(renameButton);

    await waitFor(() => {
      expect(screen.getByText('Name already exists')).toBeInTheDocument();
    });
  });
});

describe('MoveFolderDialog', () => {
  const defaultProps = {
    open: true,
    folder: mockFolders[2], // Archive folder
    folders: mockFolders,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render move dialog', () => {
    render(<MoveFolderDialog {...defaultProps} />);

    expect(screen.getByText('Move Folder')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('should call move API with correct params', async () => {
    vi.mocked(foldersApi.move).mockResolvedValue(mockFolders[2]);

    render(<MoveFolderDialog {...defaultProps} />);

    const moveButton = screen.getByRole('button', { name: /move/i });
    fireEvent.click(moveButton);

    await waitFor(() => {
      expect(foldersApi.move).toHaveBeenCalledWith('folder-3', {
        newParentId: 'folder-1', // Current parent
      });
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });
  });

  it('should show error on API failure', async () => {
    vi.mocked(foldersApi.move).mockRejectedValue({
      response: { data: { error: 'Circular reference detected' } },
    });

    render(<MoveFolderDialog {...defaultProps} />);

    const moveButton = screen.getByRole('button', { name: /move/i });
    fireEvent.click(moveButton);

    await waitFor(() => {
      expect(screen.getByText('Circular reference detected')).toBeInTheDocument();
    });
  });
});

describe('MoveTemplateDialog', () => {
  const defaultProps = {
    open: true,
    templateId: 'template-1',
    currentFolderId: 'folder-1',
    folders: mockFolders,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render move template dialog', () => {
    render(<MoveTemplateDialog {...defaultProps} />);

    expect(screen.getByText('Move Template to Folder')).toBeInTheDocument();
    expect(screen.getByLabelText(/folder/i)).toBeInTheDocument();
  });

  it('should render move template dialog with select', () => {
    render(<MoveTemplateDialog {...defaultProps} />);

    // Just verify the dialog is rendered
    expect(screen.getByText('Move Template to Folder')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('should call moveTemplate API with correct params', async () => {
    vi.mocked(foldersApi.moveTemplate).mockResolvedValue({} as any);

    render(<MoveTemplateDialog {...defaultProps} />);

    const moveButton = screen.getByRole('button', { name: /move/i });
    fireEvent.click(moveButton);

    await waitFor(() => {
      expect(foldersApi.moveTemplate).toHaveBeenCalledWith('template-1', {
        folderId: 'folder-1',
      });
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });
  });

  it('should move to unfiled', async () => {
    vi.mocked(foldersApi.moveTemplate).mockResolvedValue({} as any);

    render(<MoveTemplateDialog {...defaultProps} currentFolderId={null} />);

    const moveButton = screen.getByRole('button', { name: /move/i });
    fireEvent.click(moveButton);

    await waitFor(() => {
      expect(foldersApi.moveTemplate).toHaveBeenCalledWith('template-1', {
        folderId: null,
      });
    });
  });

  it('should show error on API failure', async () => {
    vi.mocked(foldersApi.moveTemplate).mockRejectedValue({
      response: { data: { error: 'Template not found' } },
    });

    render(<MoveTemplateDialog {...defaultProps} />);

    const moveButton = screen.getByRole('button', { name: /move/i });
    fireEvent.click(moveButton);

    await waitFor(() => {
      expect(screen.getByText('Template not found')).toBeInTheDocument();
    });
  });
});
