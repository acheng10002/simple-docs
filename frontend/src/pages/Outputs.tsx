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
  Chip,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Logout as LogoutIcon,
  Delete as DeleteIcon,
  Folder as TemplatesIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { jobsApi, mergeApi } from '../api/client';
import type { MergeJob } from '../types/api';

export default function Outputs() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [jobs, setJobs] = useState<MergeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    try {
      setLoading(true);
      const data = await jobsApi.getAll();
      setJobs(data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load merge outputs');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (filePath: string) => {
    try {
      const cleanPath = filePath.replace(/^s3:\/\/[^/]+\//, '');
      const blob = await mergeApi.downloadOutput(cleanPath);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = cleanPath.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Download failed');
    }
  };

  const handleDelete = async (jobId: number, templateName: string) => {
    if (!window.confirm(`Are you sure you want to delete this merge output from "${templateName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await jobsApi.delete(jobId);
      await loadJobs(); // Reload the list
    } catch (err: any) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'succeeded':
        return 'success';
      case 'failed':
        return 'error';
      case 'processing':
        return 'warning';
      default:
        return 'default';
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* App Bar */}
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            MergeMyDocs - Merge Outputs
          </Typography>
          <Button
            color="inherit"
            startIcon={<TemplatesIcon />}
            onClick={() => navigate('/templates')}
            sx={{ mr: 2 }}
          >
            Templates
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
          <Box sx={{ mb: 3 }}>
            <Typography variant="h5" component="h1">
              Merge Outputs
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              All your merged documents
            </Typography>
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
          ) : jobs.length === 0 ? (
            <Box sx={{ textAlign: 'center', p: 4 }}>
              <Typography variant="body1" color="text.secondary">
                No merge outputs yet. Merge a template to see results here!
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Template</TableCell>
                    <TableCell>Output Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id || job.jobId}>
                      <TableCell>{job.template?.name || 'Unknown'}</TableCell>
                      <TableCell>
                        <Chip
                          label={job.outputType?.toUpperCase() || 'PDF'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={job.status || 'succeeded'}
                          size="small"
                          color={getStatusColor(job.status)}
                        />
                      </TableCell>
                      <TableCell>
                        {job.createdAt
                          ? new Date(job.createdAt).toLocaleString()
                          : 'Unknown'}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => handleDownload(job.filePath)}
                          title="Download"
                          disabled={job.status === 'failed'}
                        >
                          <DownloadIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(job.id!, job.template?.name || 'Unknown')}
                          title="Delete"
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
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
