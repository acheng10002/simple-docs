import React, { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Collapse,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Divider,
  Tooltip,
} from '@mui/material';
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  MoreVert as MoreIcon,
  CreateNewFolder as CreateFolderIcon,
  Edit as RenameIcon,
  Delete as DeleteIcon,
  DriveFileMove as MoveIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  MergeType as MergeIcon,
  Download as DownloadIcon,
  TableRows as CsvIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import type { Folder, Template } from '../types/api';
import { foldersApi } from '../api/client';

interface FolderTreeProps {
  folders: Folder[];
  templates: Template[];
  selectedFolderId: string | null;
  expandedFolderIds: Set<string>;
  onSelectFolder: (folderId: string | null) => void;
  onToggleFolder: (folderId: string) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: Folder) => void;
  onMoveFolder: (folder: Folder) => void;
  onRefresh: () => void;
  onDrop: (folderId: string) => void;
  onDragOverChange: (folderId: string | null) => void;
  dragOverFolderId: string | null;
  draggedTemplateId: string | null;
  onTemplateDragStart: (templateId: string) => void;
  onTemplateDragEnd: () => void;
  onMerge: (templateId: string) => void;
  onDownload: (templateId: string, displayName: string) => void;
  onCsvMerge: (templateId: string, event: React.ChangeEvent<HTMLInputElement>) => void;
  onEdit: (templateId: string) => void;
}

export default function FolderTree({
  folders,
  templates,
  selectedFolderId,
  expandedFolderIds,
  onSelectFolder,
  onToggleFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onRefresh,
  onDrop,
  onDragOverChange,
  dragOverFolderId,
  draggedTemplateId,
  onTemplateDragStart,
  onTemplateDragEnd,
  onMerge,
  onDownload,
  onCsvMerge,
  onEdit,
}: FolderTreeProps) {
  const [menuAnchor, setMenuAnchor] = useState<{ element: HTMLElement; folder: Folder } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, folder: Folder) => {
    event.stopPropagation();
    setMenuAnchor({ element: event.currentTarget, folder });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;

    try {
      setDeleting(true);
      setError('');
      await foldersApi.delete(deleteDialog.id);
      setDeleteDialog(null);
      onRefresh();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete folder');
    } finally {
      setDeleting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent, _folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    onDragOverChange(folderId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDragOverChange(null);
  };

  const handleDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    onDragOverChange(null);
    onDrop(folderId);
  };

  // Build hierarchy map
  const foldersByParent = folders.reduce((acc, folder) => {
    const parentId = folder.parentId || 'root';
    if (!acc[parentId]) acc[parentId] = [];
    acc[parentId].push(folder);
    return acc;
  }, {} as Record<string, Folder[]>);

  const renderFolder = (folder: Folder, level: number): React.ReactNode => {
    const childFolders = foldersByParent[folder.id] || [];
    const folderTemplates = templates.filter(t => t.folderId === folder.id && t.isActive);
    const isExpanded = expandedFolderIds.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const hasChildren = childFolders.length > 0;
    const isDragOver = dragOverFolderId === folder.id;

    return (
      <Box key={folder.id}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            py: 1,
            px: 1,
            pl: level * 2 + 1,
            cursor: 'pointer',
            bgcolor: isDragOver ? 'primary.light' : (isSelected ? 'action.selected' : 'transparent'),
            '&:hover': {
              bgcolor: isDragOver ? 'primary.light' : (isSelected ? 'action.selected' : 'action.hover'),
            },
            transition: 'background-color 0.2s',
          }}
          onClick={() => onSelectFolder(isSelected ? null : folder.id)}
          onDragOver={(e) => handleDragOver(e, folder.id)}
          onDragEnter={(e) => handleDragEnter(e, folder.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, folder.id)}
        >
          {/* Expand/Collapse Icon */}
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(folder.id);
            }}
            sx={{ mr: 0.5, visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>

          {/* Folder Icon */}
          {isExpanded ? (
            <FolderOpenIcon sx={{ mr: 1, color: 'primary.main' }} />
          ) : (
            <FolderIcon sx={{ mr: 1, color: 'primary.main' }} />
          )}

          {/* Folder Name */}
          <Typography
            variant="body2"
            sx={{
              flexGrow: 1,
              fontWeight: 600,
              fontSize: '1rem',
              color: 'primary.main',
              cursor: 'pointer'
            }}
          >
            {folder.name}
          </Typography>

          {/* Menu Button */}
          <IconButton size="small" onClick={(e) => handleMenuOpen(e, folder)}>
            <MoreIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Templates in this folder */}
        {isSelected && folderTemplates.length > 0 && (
          <Box sx={{ pl: level * 2 + 8.5, py: 0.5 }}>
            {folderTemplates.map((template, index) => (
              <React.Fragment key={template.id}>
                {index > 0 && <Divider />}
                <Box
                  draggable
                  onDragStart={() => onTemplateDragStart(template.id)}
                  onDragEnd={onTemplateDragEnd}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    py: 0.75,
                    px: 1,
                    bgcolor: 'white',
                    cursor: 'grab',
                    '&:active': { cursor: 'grabbing' },
                    '&:hover': { bgcolor: 'action.hover' },
                    opacity: draggedTemplateId === template.id ? (dragOverFolderId ? 0.3 : 0.5) : 1,
                  }}
                >
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    {template.displayName}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => onEdit(template.id)}
                        sx={{ color: '#B03060' }}
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Download">
                      <IconButton
                        size="small"
                        onClick={() => onDownload(template.id, template.displayName)}
                        color="success"
                      >
                        <DownloadIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Merge">
                      <IconButton
                        size="small"
                        onClick={() => onMerge(template.id)}
                        color="primary"
                      >
                        <MergeIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Bulk Merge CSV">
                      <IconButton
                        size="small"
                        component="label"
                        sx={{ color: '#9c27b0' }}
                      >
                        <CsvIcon />
                        <input
                          type="file"
                          hidden
                          accept=".csv"
                          onChange={(e) => onCsvMerge(template.id, e)}
                        />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </React.Fragment>
            ))}
          </Box>
        )}

        {/* Divider between templates and nested folders */}
        {isSelected && folderTemplates.length > 0 && hasChildren && (
          <Divider sx={{ my: 1 }} />
        )}

        {/* Children */}
        {hasChildren && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            {/* Divider between parent folder and first child (only if templates aren't showing) */}
            {!(isSelected && folderTemplates.length > 0) && (
              <Divider sx={{ ml: level * 2 + 1 }} />
            )}
            {childFolders.map((child, index) => (
              <React.Fragment key={child.id}>
                {renderFolder(child, level + 1)}
                {index < childFolders.length - 1 && <Divider sx={{ ml: (level + 1) * 2 + 1 }} />}
              </React.Fragment>
            ))}
          </Collapse>
        )}
      </Box>
    );
  };

  const rootFolders = foldersByParent['root'] || [];

  return (
    <Box>
      {rootFolders.map((folder, index) => (
        <React.Fragment key={folder.id}>
          {renderFolder(folder, 0)}
          {index < rootFolders.length - 1 && <Divider />}
        </React.Fragment>
      ))}

      {/* Context Menu */}
      {menuAnchor && (
        <Menu
          anchorEl={menuAnchor.element}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
        >
          {menuAnchor.folder.depth < 4 && (
            <MenuItem
              onClick={() => {
                handleMenuClose();
                onCreateFolder(menuAnchor.folder.id);
              }}
            >
              <ListItemIcon>
                <CreateFolderIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>New Subfolder</ListItemText>
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              handleMenuClose();
              onRenameFolder(menuAnchor.folder);
            }}
          >
            <ListItemIcon>
              <RenameIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Rename</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleMenuClose();
              onMoveFolder(menuAnchor.folder);
            }}
          >
            <ListItemIcon>
              <MoveIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Move</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleMenuClose();
              setDeleteDialog(menuAnchor.folder);
            }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        </Menu>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog !== null}
        onClose={() => !deleting && setDeleteDialog(null)}
        maxWidth="sm"
      >
        <DialogTitle>Delete Folder</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete "{deleteDialog?.name}"?
            {' '}This will also delete all subfolders and unfile all templates in this folder tree.
          </DialogContentText>
          {error && (
            <Typography color="error" sx={{ mt: 2 }}>
              {error}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={handleDelete} variant="contained" color="error" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
