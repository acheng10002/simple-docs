import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Button,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { templatesApi } from '../api/client';
import type { TemplateVersion } from '../types/api';

interface VersionHistoryProps {
  templateId: string;
  onRevertSuccess: () => void;
}

export default function VersionHistory({
  templateId,
  onRevertSuccess
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reverting, setReverting] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState<TemplateVersion | null>(null);

  useEffect(() => {
    loadVersions();
  }, [templateId]);

  const loadVersions = async () => {
    try {
      setLoading(true);
      const data = await templatesApi.getVersions(templateId);
      setVersions(data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load version history');
    } finally {
      setLoading(false);
    }
  };

  const handleRevertClick = (version: TemplateVersion) => {
    setConfirmRevert(version);
  };

  const handleRevertConfirm = async () => {
    if (!confirmRevert) return;

    try {
      setReverting(true);
      setError('');

      await templatesApi.revertToVersion(templateId, confirmRevert.id);

      await loadVersions();
      onRevertSuccess();
      setConfirmRevert(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to revert to version');
    } finally {
      setReverting(false);
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    const dateStr = date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    });
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${dateStr}, ${timeStr}`;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="h6" gutterBottom>
        Version History
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Here are your recent template versions. You can revert to a previous
        version anytime. Versions are retained for 30 days.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {versions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No version history available. Versions are created when you replace
          the template file.
        </Typography>
      ) : (
        <List>
          {versions.map((version) => (
            <ListItem
              key={version.id}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                mb: 1,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <ListItemText
                primary={`${version.versionNumber}. ${formatDateTime(version.createdAt)}`}
                secondary={`${version.fieldsSnapshot.length} field(s)`}
              />
              <Button
                variant="outlined"
                onClick={() => handleRevertClick(version)}
                disabled={reverting}
              >
                Revert
              </Button>
            </ListItem>
          ))}
        </List>
      )}

      <Dialog
        open={confirmRevert !== null}
        onClose={() => !reverting && setConfirmRevert(null)}
      >
        <DialogTitle>Confirm Revert</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to revert to version {confirmRevert?.versionNumber}?
            This will replace the current template file and fields with the version from{' '}
            {confirmRevert && formatDateTime(confirmRevert.createdAt)}.
            <br /><br />
            Your current template state will be saved as a new version before reverting.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRevert(null)} disabled={reverting}>
            Cancel
          </Button>
          <Button
            onClick={handleRevertConfirm}
            variant="contained"
            disabled={reverting}
            autoFocus
          >
            {reverting ? 'Reverting...' : 'Revert'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
