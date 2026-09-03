import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import { TableRows as CsvIcon } from '@mui/icons-material';
import type { Template } from '../types/api';

interface CsvMergeDialogProps {
  open: boolean;
  template: Template | null;
  onClose: () => void;
  onSubmit: (file: File) => void;
  loading: boolean;
}

export default function CsvMergeDialog({ open, template, onClose, onSubmit, loading }: CsvMergeDialogProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelection = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Only CSV files are supported');
      return;
    }
    setError('');
    setSelectedFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files.length > 1) {
      setError('Please upload only one CSV file');
      return;
    }
    if (files.length === 1) {
      handleFileSelection(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelection(file);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = () => {
    if (selectedFile) {
      onSubmit(selectedFile);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setError('');
      setDragActive(false);
      setSelectedFile(null);
      onClose();
    }
  };

  const fieldNames = template?.fields?.map(f => f.name) || [];

  const dropZoneStyles = {
    border: '2px dashed',
    borderColor: dragActive ? 'primary.main' : 'grey.400',
    borderRadius: 2,
    p: 4,
    textAlign: 'center',
    bgcolor: dragActive ? 'action.hover' : 'transparent',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    '&:hover': {
      borderColor: 'primary.main',
      bgcolor: 'action.hover',
    },
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Bulk Merge CSV</DialogTitle>

      <DialogContent>
        {fieldNames.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              CSV columns should match these template fields:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {fieldNames.map((name) => (
                <Chip key={name} label={name} size="small" variant="outlined" />
              ))}
            </Box>
          </Box>
        )}

        <Box
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
          sx={dropZoneStyles}
        >
          <CsvIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1.5 }} />
          {selectedFile ? (
            <>
              <Typography variant="body1" fontWeight={500}>
                {selectedFile.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Click or drag to replace
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="h6" gutterBottom>
                Drag and drop your CSV here
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                or
              </Typography>
              <Button variant="outlined" component="span">
                Click to browse
              </Button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept=".csv"
            onChange={handleFileInputChange}
          />
          <Typography variant="caption" display="block" sx={{ mt: 2 }} color="text.secondary">
            Each row in the CSV will produce a separate merge output
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mt: 2 }}>
            <CircularProgress size={24} sx={{ mr: 2 }} />
            <Typography>Merging...</Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !selectedFile}
        >
          Merge
        </Button>
      </DialogActions>
    </Dialog>
  );
}
