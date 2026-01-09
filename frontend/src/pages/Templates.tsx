import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import {
  Download as DownloadIcon,
  MergeType as MergeIcon,
  CloudUpload as UploadIcon,
  Logout as LogoutIcon,
  TableRows as CsvIcon,
  Folder as OutputsIcon,
  Edit as EditIcon,
  CheckCircle as ActivateIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { templatesApi, mergeApi } from '../api/client';
import type { Template } from '../types/api';
import UploadTemplateDialog from '../components/UploadTemplateDialog';

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

  useEffect(() => {
    loadTemplates();
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

  const handleDeactivate = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to deactivate the template "${name}"? All merge outputs will be preserved. You can reactivate it later if needed.`)) {
      return;
    }

    try {
      await templatesApi.delete(id); // API call stays the same, just sets isActive=false
      await loadTemplates();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Deactivate failed');
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

      const result = await mergeApi.mergeCsv(templateId, file, outputType);

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
            <Button
              variant="contained"
              startIcon={<UploadIcon />}
              onClick={() => setUploadDialogOpen(true)}
            >
              Upload Template
            </Button>
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
              {/* Active Templates Section */}
              {filteredTemplates.filter(t => t.isActive).length > 0 && (
                <Box sx={{ mb: 0 }}>
                  <Box sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', py: 1, borderBottom: '1px solid rgba(0, 0, 0, 0.12)', mb: 2, bgcolor: 'grey.50', px: 2 }}>
                    <Typography variant="h6" sx={{ mb: 0 }}>
                      Active Templates
                    </Typography>
                  </Box>
                  <TableContainer>
                    <Table sx={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '30%' }} />
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '20%' }} />
                      </colgroup>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ pt: 0, pb: 1.5 }}>Name</TableCell>
                          <TableCell sx={{ pt: 0, pb: 1.5 }}>Fields</TableCell>
                          <TableCell sx={{ pt: 0, pb: 1.5 }}>Created</TableCell>
                          <TableCell align="center" sx={{ pt: 0, pb: 1.5 }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredTemplates.filter(t => t.isActive).map((template) => (
                          <TableRow key={template.id}>
                            <TableCell>{template.displayName}</TableCell>
                            <TableCell>
                              {template.fields.map((f) => f.name).join(', ')}
                            </TableCell>
                            <TableCell>
                              {template.createdAt
                                ? new Date(template.createdAt).toLocaleString()
                                : 'Unknown'}
                            </TableCell>
                            <TableCell align="right">
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
                  <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, pt: 1, pb: 1, bgcolor: 'grey.50', px: 2 }}>
                    <Typography variant="h6" sx={{ mb: 0 }}>
                      Inactive Templates
                    </Typography>
                  </Box>
                  <TableContainer>
                    <Table sx={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '30%' }} />
                        <col style={{ width: '25%' }} />
                        <col style={{ width: '20%' }} />
                      </colgroup>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ pt: 0, pb: 1.5 }}>Name</TableCell>
                          <TableCell sx={{ pt: 0, pb: 1.5 }}>Fields</TableCell>
                          <TableCell sx={{ pt: 0, pb: 1.5 }}>Created</TableCell>
                          <TableCell align="center" sx={{ pt: 0, pb: 1.5 }}>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredTemplates.filter(t => !t.isActive).map((template) => (
                          <TableRow key={template.id}>
                            <TableCell sx={{ color: 'text.secondary' }}>{template.displayName}</TableCell>
                            <TableCell sx={{ color: 'text.secondary' }}>
                              {template.fields.map((f) => f.name).join(', ')}
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary' }}>
                              {template.createdAt
                                ? new Date(template.createdAt).toLocaleString()
                                : 'Unknown'}
                            </TableCell>
                            <TableCell align="center">
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
      />
    </Box>
  );
}
