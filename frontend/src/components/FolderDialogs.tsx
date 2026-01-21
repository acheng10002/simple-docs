import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import type { Folder } from '../types/api';
import { foldersApi } from '../api/client';

interface CreateFolderDialogProps {
  open: boolean;
  parentId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateFolderDialog({
  open,
  parentId,
  onClose,
  onSuccess,
}: CreateFolderDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }

    try {
      setLoading(true);
      setError('');
      await foldersApi.create({ name: name.trim(), parentId });
      setName('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create folder');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create New Folder</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          label="Folder Name"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
          disabled={loading}
          sx={{ mt: 1 }}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface RenameFolderDialogProps {
  open: boolean;
  folder: Folder | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function RenameFolderDialog({
  open,
  folder,
  onClose,
  onSuccess,
}: RenameFolderDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (folder) {
      setName(folder.name);
    }
  }, [folder]);

  const handleSubmit = async () => {
    if (!name.trim() || !folder) {
      setError('Folder name is required');
      return;
    }

    try {
      setLoading(true);
      setError('');
      await foldersApi.rename(folder.id, { name: name.trim() });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to rename folder');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Rename Folder</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          label="Folder Name"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
          disabled={loading}
          sx={{ mt: 1 }}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface MoveFolderDialogProps {
  open: boolean;
  folder: Folder | null;
  folders: Folder[];
  onClose: () => void;
  onSuccess: () => void;
}

export function MoveFolderDialog({
  open,
  folder,
  folders,
  onClose,
  onSuccess,
}: MoveFolderDialogProps) {
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (folder) {
      setNewParentId(folder.parentId);
    }
  }, [folder]);

  const handleSubmit = async () => {
    if (!folder) return;

    try {
      setLoading(true);
      setError('');
      await foldersApi.move(folder.id, { newParentId });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to move folder');
    } finally {
      setLoading(false);
    }
  };

  // Filter out the folder itself and its descendants
  const getDescendantIds = (folderId: string): Set<string> => {
    const descendants = new Set<string>([folderId]);
    const addDescendants = (id: string) => {
      folders
        .filter((f) => f.parentId === id)
        .forEach((f) => {
          descendants.add(f.id);
          addDescendants(f.id);
        });
    };
    addDescendants(folderId);
    return descendants;
  };

  const excludedIds = folder ? getDescendantIds(folder.id) : new Set<string>();
  const availableFolders = folders.filter(
    (f) => !excludedIds.has(f.id) && f.depth < 4
  );

  const renderFolderOption = (f: Folder) => {
    const indent = '  '.repeat(f.depth - 1);
    return `${indent}${f.name}`;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Move Folder</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1 }}>
          <InputLabel>Parent Folder</InputLabel>
          <Select
            value={newParentId || 'root'}
            onChange={(e) => setNewParentId(e.target.value === 'root' ? null : e.target.value)}
            disabled={loading}
            label="Parent Folder"
          >
            <MenuItem value="root">(Root Level)</MenuItem>
            {availableFolders.map((f) => (
              <MenuItem key={f.id} value={f.id}>
                {renderFolderOption(f)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface MoveTemplateDialogProps {
  open: boolean;
  templateId: string | null;
  currentFolderId: string | null;
  folders: Folder[];
  onClose: () => void;
  onSuccess: () => void;
}

export function MoveTemplateDialog({
  open,
  templateId,
  currentFolderId,
  folders,
  onClose,
  onSuccess,
}: MoveTemplateDialogProps) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFolderId(currentFolderId);
  }, [currentFolderId]);

  const handleSubmit = async () => {
    if (!templateId) return;

    try {
      setLoading(true);
      setError('');
      await foldersApi.moveTemplate(templateId, { folderId });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to move template');
    } finally {
      setLoading(false);
    }
  };

  const renderFolderOption = (f: Folder) => {
    const indent = '  '.repeat(f.depth - 1);
    return `${indent}${f.name}`;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Move Template to Folder</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1 }}>
          <InputLabel>Folder</InputLabel>
          <Select
            value={folderId || 'unfiled'}
            onChange={(e) => setFolderId(e.target.value === 'unfiled' ? null : e.target.value)}
            disabled={loading}
          >
            <MenuItem value="unfiled">(Unfiled)</MenuItem>
            {folders
              .sort((a, b) => {
                if (a.depth !== b.depth) return a.depth - b.depth;
                return a.name.localeCompare(b.name);
              })
              .map((f) => (
                <MenuItem key={f.id} value={f.id}>
                  {renderFolderOption(f)}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}
