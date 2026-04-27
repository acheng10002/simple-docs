import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '@mui/material';
import { CloudUpload as CloudUploadIcon } from '@mui/icons-material';
import { templatesApi } from '../api/client';

interface UploadTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  existingTemplateNames?: string[];
}

export default function UploadTemplateDialog({ open, onClose, existingTemplateNames = [] }: UploadTemplateDialogProps) {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'text/html', // .html
    'application/pdf', // .pdf
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  ];

  const uploadFile = async (file: File) => {
    try {
      setUploading(true);
      setError('');
      const response = await templatesApi.upload(file);
      navigate(`/templates/${response.templateId}/edit`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Upload failed');
      setUploading(false);
    }
  };

  const handleFileSelection = async (file: File) => {
    // Validate file type
    if (!validTypes.includes(file.type)) {
      setError('Only .docx, .html, .pdf, .xlsx, and .pptx files are supported');
      return;
    }

    // Check for duplicate name
    if (existingTemplateNames.includes(file.name)) {
      setPendingFile(file);
      setDuplicateWarning(`A template named "${file.name}" already exists. Upload anyway?`);
      return;
    }

    await uploadFile(file);
  };

  const handleDuplicateProceed = async () => {
    if (pendingFile) {
      setDuplicateWarning('');
      await uploadFile(pendingFile);
      setPendingFile(null);
    }
  };

  const handleDuplicateCancel = () => {
    setDuplicateWarning('');
    setPendingFile(null);
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
      setError('Please upload only one file at a time');
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

  const handleClose = () => {
    if (!uploading) {
      setError('');
      setDragActive(false);
      setDuplicateWarning('');
      setPendingFile(null);
      onClose();
    }
  };

  const dropZoneStyles = {
    border: '2px dashed',
    borderColor: dragActive ? 'primary.main' : 'grey.400',
    borderRadius: 2,
    p: 6,
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
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>Upload Template</DialogTitle>

      <DialogContent>
        <Box
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
          sx={dropZoneStyles}
        >
          <CloudUploadIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Drag and drop your template here
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            or
          </Typography>
          <Button variant="outlined" component="span">
            Click to browse
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept=".docx,.html,.pdf,.xlsx,.pptx"
            onChange={handleFileInputChange}
          />
          <Typography variant="caption" display="block" sx={{ mt: 2 }} color="text.secondary">
            Supported formats: .docx, .html, .pdf, .xlsx, .pptx
          </Typography>
        </Box>

        {duplicateWarning && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {duplicateWarning}
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {uploading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mt: 2 }}>
            <CircularProgress size={24} sx={{ mr: 2 }} />
            <Typography>Uploading...</Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={uploading}>
          Cancel
        </Button>
        {duplicateWarning && (
          <Button onClick={handleDuplicateProceed}>
            Upload
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
