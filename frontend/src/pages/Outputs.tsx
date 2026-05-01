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
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Delete as DeleteIcon,
  Folder as TemplatesIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/SupabaseAuthContext';
import { jobsApi, mergeApi } from '../api/client';
import type { MergeJob } from '../types/api';

export default function Outputs() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [jobs, setJobs] = useState<MergeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<{ jobId: number; templateName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const handleDelete = async () => {
    if (!deleteDialog) return;

    try {
      setDeleting(true);
      await jobsApi.delete(deleteDialog.jobId);
      setDeleteDialog(null);
      await loadJobs();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(false);
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
                    <TableCell sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', pt: 2, pb: 1.5 }}>Output File</TableCell>
                    <TableCell sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', pt: 2, pb: 1.5 }}>Template</TableCell>
                    <TableCell sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', pt: 2, pb: 1.5 }}>Status</TableCell>
                    <TableCell sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', pt: 2, pb: 1.5 }}>Created</TableCell>
                    <TableCell align="right" sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', pt: 2, pb: 1.5, pr: 3 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id || job.jobId}>
                      <TableCell>
                        {job.filePath.replace(/^s3:\/\/[^/]+\//, '').split('/').pop() || 'Unknown'}
                      </TableCell>
                      <TableCell>{job.template?.displayName || 'Unknown'}</TableCell>
                      <TableCell>
                        <Chip
                          label={job.status || 'succeeded'}
                          size="small"
                          color={job.status === 'succeeded' ? undefined : getStatusColor(job.status)}
                          sx={job.status === 'succeeded' || !job.status ? {
                            backgroundColor: '#4caf50',
                            color: 'white',
                          } : {}}
                        />
                      </TableCell>
                      <TableCell>
                        {job.createdAt
                          ? new Date(job.createdAt).toLocaleString()
                          : 'Unknown'}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Download">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => handleDownload(job.filePath)}
                              disabled={job.status === 'failed'}
                              color="success"
                            >
                              <DownloadIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => setDeleteDialog({ jobId: job.id!, templateName: job.template?.displayName || 'Unknown' })}
                            color="error"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Container>

      <Dialog
        open={deleteDialog !== null}
        onClose={() => !deleting && setDeleteDialog(null)}
        maxWidth="sm"
      >
        <DialogTitle>Delete Merge Output</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this merge output from "{deleteDialog?.templateName}"? This action cannot be undone.
          </DialogContentText>
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
