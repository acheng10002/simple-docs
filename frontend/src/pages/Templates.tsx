import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
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
  AppBar,
  Toolbar,
  Tooltip,
  TextField,
  RadioGroup,
  FormControlLabel,
  Radio,
  Divider,
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
import { templatesApi, mergeApi, foldersApi } from '../api/client';
import type { Template, Folder } from '../types/api';
import UploadTemplateDialog from '../components/UploadTemplateDialog';
import FolderTree from '../components/FolderTree';
import {
  CreateFolderDialog,
  RenameFolderDialog,
  MoveFolderDialog,
  MoveTemplateDialog,
} from '../components/FolderDialogs';
import { CreateNewFolder as CreateFolderIcon } from '@mui/icons-material';

export default function Templates() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [csvMerging, setCsvMerging] = useState(false);
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
      setError(err.response?.data?.error || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to reactivate the template "${name}"?`)) {
      return;
    }

    try {
      await templatesApi.activate(id);
      await loadTemplates();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Activate failed');
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
      setError(err.response?.data?.error || 'Download failed');
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
      setCsvMerging(true);

      // Find the template to get its defaultOutputType
      const template = templates.find(t => t.id === templateId);
      const outputType = template?.defaultOutputType || 'pdf';

      await mergeApi.mergeCsv(templateId, file, outputType);

      // Navigate to outputs page to see all generated files
      navigate('/outputs');

      // Reset file input
      event.target.value = '';
    } catch (err: any) {
      setError(err.response?.data?.error || 'CSV merge failed');
    } finally {
      setCsvMerging(false);
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
      await loadTemplates();
      await loadFolders();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to move template');
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
      await foldersApi.moveTemplate(draggedTemplateId, { folderId: null });
      await loadTemplates();
      await loadFolders();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to remove template from folder');
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

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* App Bar */}
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            MergeMyDocs - Templates
          </Typography>
          <Button
            color="inherit"
            startIcon={<OutputsIcon />}
            onClick={() => navigate('/outputs')}
            sx={{ mr: 2 }}
          >
            Outputs
          </Button>
          <Button
            color="inherit"
            startIcon={<SettingsIcon />}
            onClick={() => navigate('/settings')}
            sx={{ mr: 2 }}
          >
            Settings
          </Button>
          <Typography variant="body2" sx={{ mr: 2 }}>
            {user?.email}
          </Typography>
          <Button color="inherit" onClick={handleLogout}>
            Log Out
          </Button>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 3 }}>
            <Typography variant="h5" component="h1" sx={{ flexGrow: 1 }}>
              My Templates
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mr: 9 }}>
              <TextField
                variant="outlined"
                placeholder="Search templates by name or field..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                size="small"
                sx={{ width: 400, mb: 0.5 }}
              />
              <RadioGroup
                row
                value={searchScope}
                onChange={(e) => setSearchScope(e.target.value as 'all' | 'active' | 'inactive')}
                sx={{
                  '& .MuiFormControlLabel-label': { fontSize: '0.875rem' },
                  '& .MuiFormControlLabel-root': { ml: -1, mr: 5 },
                  '& .MuiRadio-root': { pr: 0.5 }
                }}
              >
                <FormControlLabel value="all" control={<Radio size="small" />} label="All" />
                <FormControlLabel value="active" control={<Radio size="small" />} label="Active" />
                <FormControlLabel value="inactive" control={<Radio size="small" />} label="Inactive" />
              </RadioGroup>
            </Box>
            <Box sx={{ display: 'flex', gap: 3 }}>
              <Button
                variant="outlined"
                startIcon={<CreateFolderIcon />}
                onClick={handleCreateFolder}
              >
                + Folder
              </Button>
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={() => setUploadDialogOpen(true)}
              >
                Upload Template
              </Button>
            </Box>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : templates.length === 0 ? (
            <Box sx={{ textAlign: 'center', p: 4 }}>
              <Typography variant="body1" color="text.secondary">
                No templates yet. Upload your first template to get started!
              </Typography>
            </Box>
          ) : filteredTemplates.length === 0 ? (
            <Box sx={{ textAlign: 'center', p: 4 }}>
              <Typography variant="body1" color="text.secondary">
                No templates found matching your search.
              </Typography>
            </Box>
          ) : (
            <>
              {searchQuery ? (
                /* Flat search results view — no folders, no drag-and-drop */
                <>
                  {filteredTemplates.filter(t => t.isActive).length > 0 && (
                    <Box sx={{ mb: 0 }}>
                      <Box sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', py: 1, borderBottom: '1px solid rgba(0, 0, 0, 0.12)', bgcolor: 'grey.200', px: 2 }}>
                        <Typography variant="h6" sx={{ mb: 0 }}>
                          Active Templates
                        </Typography>
                      </Box>
                      <TableContainer sx={{ padding: 0 }}>
                        <Table sx={{ tableLayout: 'fixed', marginTop: 0 }}>
                          <colgroup>
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '30%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '20%' }} />
                          </colgroup>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.50' }}>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Name</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Fields</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Created</TableCell>
                              <TableCell align="center" sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {filteredTemplates.filter(t => t.isActive).map((template) => (
                              <TableRow key={template.id} sx={{ bgcolor: 'white' }}>
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
                                    <Tooltip title="Merge">
                                      <IconButton
                                        size="small"
                                        onClick={() => handleMerge(template.id)}
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
                                          onChange={(e) => handleCsvMerge(template.id, e)}
                                        />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Download">
                                      <IconButton
                                        size="small"
                                        onClick={() => handleDownload(template.id, template.displayName)}
                                        color="success"
                                      >
                                        <DownloadIcon />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Edit">
                                      <IconButton
                                        size="small"
                                        onClick={() => navigate(`/templates/${template.id}/edit`)}
                                        sx={{ color: '#B03060' }}
                                      >
                                        <EditIcon />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  )}

                  {filteredTemplates.filter(t => !t.isActive).length > 0 && (
                    <Box>
                      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 0, pt: 1, pb: 1, bgcolor: 'grey.200', px: 2 }}>
                        <Typography variant="h6" sx={{ mb: 0 }}>
                          Inactive Templates
                        </Typography>
                      </Box>
                      <TableContainer sx={{ padding: 0 }}>
                        <Table sx={{ tableLayout: 'fixed', marginTop: 0 }}>
                          <colgroup>
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '30%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '20%' }} />
                          </colgroup>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.50' }}>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Name</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Fields</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Created</TableCell>
                              <TableCell align="center" sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Actions</TableCell>
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
                    </Box>
                  )}
                </>
              ) : (
                /* Default view — folders, drag-and-drop, full layout */
                <>
                  {/* Active Templates Section */}
                  {filteredTemplates.filter(t => t.isActive).length > 0 && (
                    <Box sx={{ mb: 0 }}>
                      <Box sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', py: 1, borderBottom: '1px solid rgba(0, 0, 0, 0.12)', bgcolor: 'grey.200', px: 2 }}>
                        <Typography variant="h6" sx={{ mb: 0 }}>
                          Active Templates
                        </Typography>
                      </Box>

                      {/* Folder Tree */}
                      {folders.length > 0 && (
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'baseline', px: 2, bgcolor: 'grey.50', py: 1 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '1.125rem', mr: 2 }}>
                              Folders
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              Click, drag, and drop any active template into an existing folder.
                            </Typography>
                          </Box>
                          <Divider />
                          <FolderTree
                            folders={folders}
                            templates={templates}
                            selectedFolderId={selectedFolderId}
                            expandedFolderIds={expandedFolderIds}
                            onSelectFolder={setSelectedFolderId}
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
                          />
                          <Divider />
                        </Box>
                      )}
                      <TableContainer
                        sx={{
                          padding: 0,
                          bgcolor: dragOverTable ? 'primary.light' : 'transparent',
                          transition: 'background-color 0.2s',
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (draggedTemplateId) {
                            setDragOverTable(true);
                            setDragOverFolderId(null);
                          }
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          if (draggedTemplateId) {
                            setDragOverTable(true);
                            setDragOverFolderId(null);
                          }
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          // Only set to false if leaving the container entirely
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX;
                          const y = e.clientY;
                          if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                            setDragOverTable(false);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleDropOnTable();
                        }}
                      >
                        <Table sx={{ tableLayout: 'fixed', marginTop: 0 }}>
                          <colgroup>
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '30%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '20%' }} />
                          </colgroup>
                          <TableHead>
                            <TableRow sx={{ bgcolor: dragOverTable ? 'primary.light' : 'grey.50' }}>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Name</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Fields</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Created</TableCell>
                              <TableCell align="center" sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {filteredTemplates.filter(t => t.isActive && !t.folderId).map((template) => (
                              <TableRow
                                key={template.id}
                                draggable
                                onDragStart={() => handleDragStart(template.id)}
                                onDragEnd={handleDragEnd}
                                sx={{
                                  cursor: 'grab',
                                  '&:active': { cursor: 'grabbing' },
                                  opacity: draggedTemplateId === template.id ? (dragOverFolderId ? 0.3 : 0.5) : 1,
                                  bgcolor: 'white'
                                }}
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
                                    <Tooltip title="Merge">
                                      <IconButton
                                        size="small"
                                        onClick={() => handleMerge(template.id)}
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
                                          onChange={(e) => handleCsvMerge(template.id, e)}
                                        />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Download">
                                      <IconButton
                                        size="small"
                                        onClick={() => handleDownload(template.id, template.displayName)}
                                        color="success"
                                      >
                                        <DownloadIcon />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Edit">
                                      <IconButton
                                        size="small"
                                        onClick={() => navigate(`/templates/${template.id}/edit`)}
                                        sx={{ color: '#B03060' }}
                                      >
                                        <EditIcon />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  )}

                  {/* Inactive Templates Section */}
                  {filteredTemplates.filter(t => !t.isActive).length > 0 && (
                    <Box>
                      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 0, pt: 1, pb: 1, bgcolor: 'grey.200', px: 2 }}>
                        <Typography variant="h6" sx={{ mb: 0 }}>
                          Inactive Templates
                        </Typography>
                      </Box>
                      <TableContainer sx={{ padding: 0 }}>
                        <Table sx={{ tableLayout: 'fixed', marginTop: 0 }}>
                          <colgroup>
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '30%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '20%' }} />
                          </colgroup>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'grey.50' }}>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Name</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Fields</TableCell>
                              <TableCell sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Created</TableCell>
                              <TableCell align="center" sx={{ pt: 1.5, pb: 1.5, color: 'rgba(0, 0, 0, 0.87)' }}>Actions</TableCell>
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
                    </Box>
                  )}
                </>
              )}
            </>
          )}

          {/* CSV Bulk Merge Status Indicator */}
          {csvMerging && (
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
              <Typography variant="body1" sx={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                Merging...
              </Typography>
            </Box>
          )}
        </Paper>
      </Container>

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
        currentFolderId={moveTemplateDialog?.folderId || null}
        folders={folders}
        onClose={() => setMoveTemplateDialog(null)}
        onSuccess={handleFolderCreated}
      />
    </Box>
  );
}
