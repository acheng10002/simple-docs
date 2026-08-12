import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Alert,
  CircularProgress,
  Tooltip,
  TextField,
  RadioGroup,
  FormControlLabel,
  Radio,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Avatar,
} from '@mui/material';
import {
  Download as DownloadIcon,
  MergeType as MergeIcon,
  CloudUpload as UploadIcon,
  TableRows as CsvIcon,
  Folder as OutputsIcon,
  Edit as EditIcon,
  CheckCircle as ActivateIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/SupabaseAuthContext';
import { templatesApi, mergeApi, foldersApi, batchJobsApi, getErrorMessage } from '../api/client';
import type { Template, Folder } from '../types/api';
import UploadTemplateDialog from '../components/UploadTemplateDialog';
import FolderTree from '../components/FolderTree';
import {
  CreateFolderDialog,
  RenameFolderDialog,
  MoveFolderDialog,
  MoveTemplateDialog,
} from '../components/FolderDialogs';
import {
  CreateNewFolder as CreateFolderIcon,
  VerticalSplit as VerticalSplitIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Logout as LogoutIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  DriveFileMove as MoveToFolderIcon,
} from '@mui/icons-material';

interface TemplateRowProps {
  template: Template;
  onEdit: (id: string) => void;
  onDownload: (id: string, displayName: string) => void;
  onMerge: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onCsvMerge: (id: string, event: React.ChangeEvent<HTMLInputElement>) => void;
  csvMergingTemplateId: string | null;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  rowSx?: object;
}

function TemplateRow({
  template,
  onEdit,
  onDownload,
  onMerge,
  onMove,
  onCsvMerge,
  csvMergingTemplateId,
  draggable: isDraggable,
  onDragStart,
  onDragEnd,
  rowSx,
}: TemplateRowProps) {
  return (
    <React.Fragment>
      <TableRow
        draggable={isDraggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        sx={rowSx}
      >
        <TableCell sx={{ py: 1 }}>{template.displayName}</TableCell>
        <TableCell sx={{ py: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {template.fields.map((f) => f.name).join(', ')}
        </TableCell>
        <TableCell sx={{ py: 1 }}>
          {template.createdAt
            ? new Date(template.createdAt).toLocaleString()
            : 'Unknown'}
        </TableCell>
        <TableCell align="right" sx={{ py: 1 }}>
          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
            <Tooltip title="Edit">
              <IconButton
                size="small"
                onClick={() => onEdit(template.id)}
                sx={{ color: '#B03060', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}
              >
                <EditIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Move Into Folder">
              <IconButton
                size="small"
                onClick={() => onMove(template.id, template.folderId)}
                sx={{ color: '#e67300', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}
              >
                <MoveToFolderIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Download">
              <IconButton
                size="small"
                onClick={() => onDownload(template.id, template.displayName)}
                sx={{ color: '#2e7d32', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}
              >
                <DownloadIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Merge">
              <IconButton
                size="small"
                onClick={() => onMerge(template.id)}
                sx={{ color: 'primary.main', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}
              >
                <MergeIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Bulk Merge CSV">
              <IconButton
                size="small"
                component="label"
                sx={{ color: '#9c27b0', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}
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
        </TableCell>
      </TableRow>
      {csvMergingTemplateId === template.id && (
        <TableRow>
          <TableCell colSpan={4} sx={{ py: 2, bgcolor: 'white' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
              <CircularProgress size={18} />
              <Typography variant="body1" sx={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                Merging...
              </Typography>
            </Box>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

export default function Templates() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [csvMergingTemplateId, setCsvMergingTemplateId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'all' | 'active' | 'inactive'>('all');

  // Folder state
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [renameFolderDialog, setRenameFolderDialog] = useState<Folder | null>(null);
  const [moveFolderDialog, setMoveFolderDialog] = useState<Folder | null>(null);
  const [moveTemplateDialog, setMoveTemplateDialog] = useState<{ templateId: string; folderId: string | null } | null>(null);
  const [draggedTemplateId, setDraggedTemplateId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverTable, setDragOverTable] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [activateDialog, setActivateDialog] = useState<{ id: string; name: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeExpanded, setActiveExpanded] = useState(true);
  const [inactiveExpanded, setInactiveExpanded] = useState(true);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    loadTemplates();
    loadFolders();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await templatesApi.getAll();
      setTemplates(data);
      setError('');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to load templates'));
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = (id: string, name: string) => {
    setActivateDialog({ id, name });
  };

  const handleActivateConfirm = async () => {
    if (!activateDialog) return;

    try {
      await templatesApi.activate(activateDialog.id);
      await loadTemplates();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Activate failed'));
    } finally {
      setActivateDialog(null);
    }
  };

  const handleDownload = async (id: string, name: string) => {
    try {
      const blob = await templatesApi.download(id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Download failed'));
    }
  };

  const handleMerge = (templateId: string) => {
    navigate(`/templates/${templateId}/merge`);
  };

  const handleCsvMerge = async (templateId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      setError('Only CSV files are supported for bulk merge');
      return;
    }

    try {
      setError('');

      setCsvMergingTemplateId(templateId);

      // Find the template to get its defaultOutputType
      const template = templates.find(t => t.id === templateId);
      const outputType = template?.defaultOutputType || 'pdf';

      const result = await mergeApi.mergeCsv(templateId, file, outputType);

      // Check for inline merge errors (≤10 rows)
      if (!result.batchJobId && result.jobs?.length === 0) {
        setError('CSV merge failed — no rows were merged. Check that CSV columns match the template fields.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // If batch job was queued (>10 rows), poll until complete
      if (result.batchJobId) {
        const pollInterval = 2000;
        let status = await batchJobsApi.getStatus(result.batchJobId);

        while (status.status === 'pending' || status.status === 'processing') {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          status = await batchJobsApi.getStatus(result.batchJobId);
        }

        if (status.status === 'failed') {
          setError(status.error || 'Batch merge failed');
          return;
        }
      }

      // Build navigation state with partial failure warning if applicable
      const failedCount = result.errors?.length || 0;
      const navState = failedCount > 0
        ? { warning: `${failedCount} of ${result.count} rows failed to merge.` }
        : undefined;

      // Navigate to outputs page to see all generated files
      navigate('/outputs', { state: navState });

      // Reset file input
      event.target.value = '';
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 429) {
        setError('Too many CSV merges. Please try again later.');
      } else {
        setError(getErrorMessage(err, 'CSV merge failed'));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {

      setCsvMergingTemplateId(null);
    }
  };

  const loadFolders = async () => {
    try {
      const data = await foldersApi.getAll();
      setFolders(data);
      setExpandedFolderIds(new Set(data.map(f => f.id)));
    } catch (err: any) {
      console.error('Failed to load folders:', err);
    }
  };

  const handleCreateFolder = () => {
    setCreateFolderParentId(null);
    setCreateFolderDialogOpen(true);
  };

  const handleFolderCreated = () => {
    loadFolders();
    loadTemplates();
  };

  const handleToggleFolder = (folderId: string) => {
    setExpandedFolderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleDragStart = (templateId: string) => {
    setDraggedTemplateId(templateId);
    const template = templates.find(t => t.id === templateId);
    if (!template?.folderId) {
      setSelectedFolderId(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedTemplateId(null);
    setDragOverFolderId(null);
    setDragOverTable(false);
  };

  const handleDropOnFolder = async (folderId: string) => {
    if (!draggedTemplateId) return;

    try {
      await foldersApi.moveTemplate(draggedTemplateId, { folderId });
      setSelectedFolderId(folderId);
      setSelectedTemplateId(null);
      await loadTemplates();
      await loadFolders();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to move template'));
    } finally {
      setDraggedTemplateId(null);
    }
  };

  const handleDropOnTable = async () => {
    if (!draggedTemplateId) return;

    // Check if the template is already unfiled
    const template = templates.find(t => t.id === draggedTemplateId);
    if (!template?.folderId) {
      setDraggedTemplateId(null);
      setDragOverTable(false);
      return;
    }

    try {
      const templateId = draggedTemplateId;
      await foldersApi.moveTemplate(draggedTemplateId, { folderId: null });
      setSelectedFolderId(null);
      setSelectedTemplateId(templateId);
      await loadTemplates();
      await loadFolders();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to remove template from folder'));
    } finally {
      setDraggedTemplateId(null);
      setDragOverTable(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Filter templates based on search query and scope
  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = searchQuery === '' ||
      template.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.fields.some(field => field.name.toLowerCase().includes(searchQuery.toLowerCase()));

    if (searchScope === 'active') {
      return matchesSearch && template.isActive;
    } else if (searchScope === 'inactive') {
      return matchesSearch && !template.isActive;
    }
    return matchesSearch;
  });

  const [sidebarWidth, setSidebarWidth] = useState(300);
  const isResizing = React.useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(500, startWidth + (e.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }} onClick={() => { setSelectedFolderId(null); setSelectedTemplateId(null); }}>
      <Box sx={{ display: 'flex', flexGrow: 1 }}>
        {/* Sidebar */}
        {!sidebarOpen && (
          <Box sx={{ borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 2, px: 0.5, bgcolor: 'background.default' }}>
            <Tooltip title="Open Sidebar" placement="right">
              <IconButton size="small" onClick={() => setSidebarOpen(true)} sx={{ color: 'primary.main', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}>
                <VerticalSplitIcon />
              </IconButton>
            </Tooltip>
            <Box sx={{ flexGrow: 1 }} />
            <Tooltip title={user?.email || ''} placement="right">
              <Avatar
                onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: 'primary.main',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  mb: 2,
                  '&:hover': { filter: 'brightness(0.85)' },
                }}
              >
                {(user?.email || '?')[0].toUpperCase()}
              </Avatar>
            </Tooltip>
          </Box>
        )}
        {sidebarOpen && <Box sx={{ display: 'flex', position: 'relative' }}>
          <Paper
          square
          elevation={0}
          onClick={(e) => e.stopPropagation()}
          sx={{
            width: sidebarWidth,
            minWidth: sidebarWidth,
            borderRight: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
            bgcolor: 'background.default',
          }}
        >
          {/* Branding */}
          <Box sx={{ pt: 3, pb: 1.5, px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Typography sx={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>M</Typography>
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary' }}>
              MergeMyDocs
            </Typography>
          </Box>
          <Divider />

          {/* Folders header */}
          <Box sx={{ pt: 2, pb: 1, px: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '1.05rem' }}>
              Folders
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Add Folder">
                <IconButton size="small" onClick={handleCreateFolder} sx={{ color: 'primary.main', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}>
                  <CreateFolderIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Close Sidebar">
                <IconButton size="small" onClick={() => setSidebarOpen(false)} sx={{ color: 'primary.main', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}>
                  <VerticalSplitIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
          {folders.length > 0 ? (
            <FolderTree
              folders={folders}
              templates={templates}
              selectedFolderId={selectedFolderId}
              expandedFolderIds={expandedFolderIds}
              onSelectFolder={(id) => { setSelectedFolderId(id); setSelectedTemplateId(null); }}
              onToggleFolder={handleToggleFolder}
              onCreateFolder={(parentId) => {
                setCreateFolderParentId(parentId);
                setCreateFolderDialogOpen(true);
              }}
              onRenameFolder={setRenameFolderDialog}
              onMoveFolder={setMoveFolderDialog}
              onRefresh={handleFolderCreated}
              onDrop={handleDropOnFolder}
              onDragOverChange={setDragOverFolderId}
              dragOverFolderId={dragOverFolderId}
              draggedTemplateId={draggedTemplateId}
              onTemplateDragStart={handleDragStart}
              onTemplateDragEnd={handleDragEnd}
              onMerge={handleMerge}
              onDownload={handleDownload}
              onCsvMerge={handleCsvMerge}
              onEdit={(templateId) => navigate(`/templates/${templateId}/edit`)}
              onMoveTemplate={(id, folderId) => setMoveTemplateDialog({ templateId: id, folderId })}
            />
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No folders yet
              </Typography>
            </Box>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Divider />
          {/* User section */}
          <Box
            onClick={(e) => setUserMenuAnchor(e.currentTarget)}
            sx={{
              p: 1.5,
              mx: 0.5,
              my: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              cursor: 'pointer',
              borderRadius: 0.75,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: 'primary.main',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {(user?.email || '?')[0].toUpperCase()}
            </Avatar>
            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.primary' }}>
              {user?.email}
            </Typography>
          </Box>
        </Paper>
          <Box
            onMouseDown={handleMouseDown}
            sx={{
              width: 4,
              cursor: 'col-resize',
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              '&:hover': { bgcolor: 'primary.light' },
              transition: 'background-color 0.2s',
            }}
          />
        </Box>}

        {/* Main Content */}
        <Box sx={{ flexGrow: 1, py: 3, px: 6, overflow: 'auto' }}>
          {/* Toolbar */}
          <Box sx={{ display: 'flex', alignItems: 'center', mb: searchOpen ? 1.5 : 3, gap: 2 }}>
            <Typography variant="h6" component="h1" sx={{ mr: 'auto', fontWeight: 700, mt: -1 }}>
              My Templates
            </Typography>
            <Tooltip title="Search">
              <IconButton
                onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) { setSearchQuery(''); setSearchScope('all'); } }}
                sx={{ color: searchOpen ? 'primary.main' : 'text.secondary', '&:hover': { bgcolor: 'transparent', filter: 'brightness(0.7)' } }}
              >
                {searchOpen ? <CloseIcon /> : <SearchIcon />}
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<UploadIcon />}
              onClick={() => setUploadDialogOpen(true)}
            >
              Upload
            </Button>
          </Box>
          {/* Search panel */}
          <Collapse in={searchOpen}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <TextField
                variant="outlined"
                placeholder="Search template by name or field..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                size="small"
                autoFocus
                sx={{ flex: 1 }}
              />
              <RadioGroup
                row
                value={searchScope}
                onChange={(e) => setSearchScope(e.target.value as 'all' | 'active' | 'inactive')}
                sx={{
                  '& .MuiFormControlLabel-label': { fontSize: '0.8rem' },
                  '& .MuiFormControlLabel-root': { ml: -0.5, mr: 1.5 },
                  '& .MuiRadio-root': { pr: 0.5 }
                }}
              >
                <FormControlLabel value="all" control={<Radio size="small" />} label="All" />
                <FormControlLabel value="active" control={<Radio size="small" />} label="Active" />
                <FormControlLabel value="inactive" control={<Radio size="small" />} label="Inactive" />
              </RadioGroup>
            </Box>
          </Collapse>

          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : templates.length === 0 ? (
            <Paper sx={{ textAlign: 'center', p: 6 }}>
              <Typography variant="body1" color="text.secondary">
                No templates yet. Upload your first template to get started!
              </Typography>
            </Paper>
          ) : filteredTemplates.length === 0 ? (
            <Paper sx={{ textAlign: 'center', p: 6 }}>
              <Typography variant="body1" color="text.secondary">
                No templates found matching your search.
              </Typography>
            </Paper>
          ) : (
            <>
              {/* Active Templates */}
              {filteredTemplates.filter(t => t.isActive).length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Paper
                    sx={{
                      py: 0.75,
                      px: 2,
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      mb: activeExpanded ? 1 : 0,
                      bgcolor: 'grey.50',
                    }}
                    onClick={() => setActiveExpanded(!activeExpanded)}
                  >
                    <IconButton size="small" sx={{ mr: 1 }}>
                      {activeExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                    </IconButton>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Active Templates
                    </Typography>
                  </Paper>
                  <Collapse in={activeExpanded}>
                  <Paper sx={{ overflow: 'hidden' }}>
                  <TableContainer
                    onClick={(e) => e.stopPropagation()}
                    sx={{ padding: 0 }}
                  >
                    <Table sx={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '32%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '18%' }} />
                      </colgroup>
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                          <TableCell sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Name</TableCell>
                          <TableCell sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Fields</TableCell>
                          <TableCell sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Created</TableCell>
                          <TableCell align="center" sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(searchQuery
                          ? filteredTemplates.filter(t => t.isActive)
                          : filteredTemplates.filter(t => t.isActive && !t.folderId)
                        ).map((template) => (
                          <TemplateRow
                            key={template.id}
                            template={template}
                            onEdit={(id) => navigate(`/templates/${id}/edit`)}
                            onDownload={handleDownload}
                            onMerge={handleMerge}
                            onMove={(id, folderId) => setMoveTemplateDialog({ templateId: id, folderId })}
                            onCsvMerge={handleCsvMerge}
                            csvMergingTemplateId={csvMergingTemplateId}
                            rowSx={{
                              bgcolor: selectedTemplateId === template.id ? 'action.selected' : 'white',
                              '&:hover': { bgcolor: 'action.hover' }
                            }}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </Paper>
                  </Collapse>
                </Box>
              )}

              {/* Inactive Templates */}
              {filteredTemplates.filter(t => !t.isActive).length > 0 && (
                <Box>
                  <Paper
                    sx={{
                      py: 0.75,
                      px: 2,
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      mb: inactiveExpanded ? 1 : 0,
                      bgcolor: 'grey.50',
                    }}
                    onClick={() => setInactiveExpanded(!inactiveExpanded)}
                  >
                    <IconButton size="small" sx={{ mr: 1 }}>
                      {inactiveExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                    </IconButton>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Inactive Templates
                    </Typography>
                  </Paper>
                  <Collapse in={inactiveExpanded}>
                  <Paper sx={{ overflow: 'hidden' }}>
                  <TableContainer sx={{ padding: 0 }}>
                    <Table sx={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '32%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '18%' }} />
                      </colgroup>
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'grey.50' }}>
                          <TableCell sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Name</TableCell>
                          <TableCell sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Fields</TableCell>
                          <TableCell sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Created</TableCell>
                          <TableCell align="center" sx={{ py: 1.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.875rem' }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredTemplates.filter(t => !t.isActive).map((template) => (
                          <TableRow key={template.id} sx={{ bgcolor: 'white' }}>
                            <TableCell sx={{ color: 'text.secondary', py: 1 }}>{template.displayName}</TableCell>
                            <TableCell sx={{ color: 'text.secondary', py: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {template.fields.map((f) => f.name).join(', ')}
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', py: 1 }}>
                              {template.createdAt
                                ? new Date(template.createdAt).toLocaleString()
                                : 'Unknown'}
                            </TableCell>
                            <TableCell align="center" sx={{ py: 1 }}>
                              <Tooltip title="Activate">
                                <IconButton
                                  size="small"
                                  onClick={() => handleActivate(template.id, template.displayName)}
                                  sx={{ color: '#2e7d32' }}
                                >
                                  <ActivateIcon />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </Paper>
                  </Collapse>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* User Menu */}
      <Menu
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={() => setUserMenuAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { minWidth: 180, py: 0, '& .MuiList-root': { py: '3.5px' }, '& .MuiMenuItem-root': { borderRadius: 0.75, mx: 0.5 } } } }}
      >
        <MenuItem onClick={() => { setUserMenuAnchor(null); navigate('/outputs'); }}>
          <ListItemIcon><OutputsIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Outputs</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setUserMenuAnchor(null); navigate('/settings'); }}>
          <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Settings</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => { setUserMenuAnchor(null); handleLogout(); }}
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
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '0.85rem' }}>Log Out</ListItemText>
        </MenuItem>
      </Menu>

      {/* Upload Template Dialog */}
      <UploadTemplateDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        existingTemplateNames={templates.filter(t => t.isActive).map(t => t.displayName)}
      />

      {/* Folder Dialogs */}
      <CreateFolderDialog
        open={createFolderDialogOpen}
        parentId={createFolderParentId}
        onClose={() => setCreateFolderDialogOpen(false)}
        onSuccess={handleFolderCreated}
      />

      <RenameFolderDialog
        open={renameFolderDialog !== null}
        folder={renameFolderDialog}
        onClose={() => setRenameFolderDialog(null)}
        onSuccess={handleFolderCreated}
      />

      <MoveFolderDialog
        open={moveFolderDialog !== null}
        folder={moveFolderDialog}
        folders={folders}
        onClose={() => setMoveFolderDialog(null)}
        onSuccess={handleFolderCreated}
      />

      <MoveTemplateDialog
        open={moveTemplateDialog !== null}
        templateId={moveTemplateDialog?.templateId || null}
        templateName={templates.find(t => t.id === moveTemplateDialog?.templateId)?.displayName}
        currentFolderId={moveTemplateDialog?.folderId || null}
        folders={folders}
        onClose={() => setMoveTemplateDialog(null)}
        onSuccess={handleFolderCreated}
      />

      {/* Activate Confirmation Dialog */}
      <Dialog
        open={activateDialog !== null}
        onClose={() => setActivateDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Activate Template</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mt: 1 }}>
            Are you sure you want to reactivate "{activateDialog?.name}"?
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActivateDialog(null)}>
            Cancel
          </Button>
          <Button onClick={handleActivateConfirm}>
            Activate
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
