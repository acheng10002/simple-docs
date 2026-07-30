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
} from '@mui/material';
import {
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
import { foldersApi, getErrorMessage } from '../api/client';

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
  const [templateMenuAnchor, setTemplateMenuAnchor] = useState<{ element: HTMLElement; template: Template } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, folder: Folder) => {
    event.stopPropagation();
    onSelectFolder(folder.id);
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
      setError(getErrorMessage(err, 'Failed to delete folder'));
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
    const hasContents = hasChildren || folderTemplates.length > 0;
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
            bgcolor: isDragOver ? 'grey.50' : 'transparent',
            '&:hover:not(:has(.menu-button:hover))': {
              bgcolor: isDragOver ? 'grey.50' : 'action.hover',
            },
            borderRadius: 0.75,
            mx: 0.5,
            transition: 'background-color 0.2s',
          }}
          onClick={() => onToggleFolder(folder.id)}
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
            sx={{ mr: 0.5, visibility: hasContents ? 'visible' : 'hidden' }}
          >
            {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>

          {/* Folder Icon */}
          <FolderOpenIcon sx={{ mr: 1, color: 'primary.main' }} />

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
          <IconButton className="menu-button" size="small" onClick={(e) => handleMenuOpen(e, folder)} sx={{ '&:hover': { bgcolor: 'action.hover', borderRadius: 0.5 } }}>
            <MoreIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Box>

        {/* Templates in this folder */}
        {(isSelected || isExpanded) && folderTemplates.length > 0 && (
          <Box sx={{ pl: level * 2 + 8.5, pr: 0.5, py: 0.5 }}>
            {folderTemplates.map((template) => (
              <React.Fragment key={template.id}>
                <Box
                  draggable
                  onDragStart={() => onTemplateDragStart(template.id)}
                  onDragEnd={onTemplateDragEnd}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    py: 0.75,
                    px: 1,
                    bgcolor: 'transparent',
                    cursor: 'grab',
                    '&:active': { cursor: 'grabbing' },
                    '&:hover:not(:has(.menu-button:hover))': { bgcolor: 'action.hover' },
                    borderRadius: 0.75,
                    opacity: draggedTemplateId === template.id ? (dragOverFolderId ? 0.3 : 0.5) : 1,
                  }}
                >
                  <Typography variant="body2" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {template.displayName}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTemplateMenuAnchor({ element: e.currentTarget, template });
                    }}
                    className="menu-button"
                    sx={{ '&:hover': { bgcolor: 'action.hover', borderRadius: 0.5 } }}
                  >
                    <MoreIcon sx={{ fontSize: 19 }} />
                  </IconButton>
                </Box>
              </React.Fragment>
            ))}
          </Box>
        )}

        {/* Children */}
        {hasChildren && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            {childFolders.map((child) => (
              <React.Fragment key={child.id}>
                {renderFolder(child, level + 1)}
              </React.Fragment>
            ))}
          </Collapse>
        )}
      </Box>
    );
  };

  const rootFolders = foldersByParent['root'] || [];

  return (
    <Box sx={{ pt: 0.5 }}>
      {rootFolders.map((folder) => (
        <React.Fragment key={folder.id}>
          {renderFolder(folder, 0)}
        </React.Fragment>
      ))}

      {/* Context Menu */}
      {menuAnchor && (
        <Menu
          anchorEl={menuAnchor.element}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { maxWidth: 200, py: 0, '& .MuiList-root': { py: '3.5px' }, '& .MuiMenuItem-root': { borderRadius: 0.75, mx: 0.5 } } } }}
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
              <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>New Subfolder</ListItemText>
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
            <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Rename</ListItemText>
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
            <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Move</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleMenuClose();
              setDeleteDialog(menuAnchor.folder);
            }}
            sx={{
              color: '#b71c1c',
              '& .MuiListItemIcon-root': { color: '#b71c1c' },
              '&:hover': {
                bgcolor: '#d32f2f',
                color: '#fff',
                '& .MuiListItemIcon-root': { color: '#fff' },
              },
            }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Delete</ListItemText>
          </MenuItem>
        </Menu>
      )}

      {/* Template Context Menu */}
      {templateMenuAnchor && (
        <Menu
          anchorEl={templateMenuAnchor.element}
          open={Boolean(templateMenuAnchor)}
          onClose={() => setTemplateMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { maxWidth: 200, py: 0, '& .MuiList-root': { py: '3.5px' }, '& .MuiMenuItem-root': { borderRadius: 0.75, mx: 0.5 } } } }}
        >
          <MenuItem
            onClick={() => {
              onEdit(templateMenuAnchor.template.id);
              setTemplateMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Edit</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              onDownload(templateMenuAnchor.template.id, templateMenuAnchor.template.displayName);
              setTemplateMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Download</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              onMerge(templateMenuAnchor.template.id);
              setTemplateMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <MergeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Merge</ListItemText>
          </MenuItem>
          <MenuItem
            component="label"
            onClick={() => {}}
          >
            <ListItemIcon>
              <CsvIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Bulk Merge CSV</ListItemText>
            <input
              type="file"
              hidden
              accept=".csv"
              onChange={(e) => {
                if (templateMenuAnchor) {
                  onCsvMerge(templateMenuAnchor.template.id, e);
                }
                setTemplateMenuAnchor(null);
              }}
            />
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
            Are you sure you want to delete "{deleteDialog?.name}"? This will also delete any subfolders and unfile all templates in this folder.
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
          <Button onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
