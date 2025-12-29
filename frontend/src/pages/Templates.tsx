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
} from '@mui/material';
import {
  Download as DownloadIcon,
  MergeType as MergeIcon,
  CloudUpload as UploadIcon,
  Logout as LogoutIcon,
  TableRows as CsvIcon,
  Folder as OutputsIcon,
  Archive as ArchiveIcon,
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
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/html',
    ];
    if (!validTypes.includes(file.type)) {
      setError('Only .docx and .html files are supported');
      return;
    }

    try {
      setUploading(true);
      setError('');
      await templatesApi.upload(file);
      await loadTemplates(); // Reload list
      event.target.value = ''; // Reset input
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

      // Default to PDF for CSV bulk merge
      const result = await mergeApi.mergeCsv(templateId, file, 'pdf');

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
          <IconButton color="inherit" onClick={handleLogout}>
            <LogoutIcon />
          </IconButton>
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
                accept=".docx,.html"
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
                      <TableCell>{template.name}</TableCell>
                      <TableCell>
                        {template.fields.map((f) => f.name).join(', ')}
                      </TableCell>
                      <TableCell>
                        {new Date(template.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                          <IconButton
                            size="small"
                            onClick={() => handleMerge(template.id)}
                            title="Merge"
                            color="primary"
                          >
                            <MergeIcon />
                          </IconButton>
                          <IconButton
                            size="small"
                            component="label"
                            title="Bulk Merge CSV"
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
                          <IconButton
                            size="small"
                            onClick={() => handleDownload(template.id, template.name)}
                            title="Download"
                            color="success"
                          >
                            <DownloadIcon />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleDeactivate(template.id, template.name)}
                            title="Deactivate"
                            color="warning"
                          >
                            <ArchiveIcon />
                          </IconButton>
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
