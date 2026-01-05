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
} from '@mui/material';
import {
  Download as DownloadIcon,
  MergeType as MergeIcon,
  CloudUpload as UploadIcon,
  Logout as LogoutIcon,
  TableRows as CsvIcon,
  Folder as OutputsIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { templatesApi, mergeApi } from '../api/client';
import type { Template } from '../types/api';

export default function Templates() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

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

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'text/html', // .html
      'application/pdf', // .pdf
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    ];
    if (!validTypes.includes(file.type)) {
      setError('Only .docx, .html, .pdf, .xlsx, and .pptx files are supported');
      return;
    }

    try {
      setUploading(true);
      setError('');
      const response = await templatesApi.upload(file);
      event.target.value = ''; // Reset input
      // Redirect to edit page for the newly uploaded template
      navigate(`/templates/${response.templateId}/edit`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to deactivate the template "${name}"? This will hide it from your templates list, but all merge outputs will be preserved. You can reactivate it later if needed.`)) {
      return;
    }

    try {
      await templatesApi.delete(id); // API call stays the same, just sets isActive=false
      await loadTemplates();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Deactivate failed');
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
      setUploading(true);

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
      setUploading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
            <Typography variant="h5" component="h1">
              My Templates
            </Typography>
            <Button
              variant="contained"
              component="label"
              startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Upload Template'}
              <input
                type="file"
                hidden
                accept=".docx,.html,.pdf,.xlsx,.pptx"
                onChange={handleUpload}
                disabled={uploading}
              />
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
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Fields</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {templates.map((template) => (
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
          )}
        </Paper>
      </Container>
    </Box>
  );
}
