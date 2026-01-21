import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  AppBar,
  Toolbar,
  IconButton,
} from '@mui/material';
import { ArrowBack as BackIcon } from '@mui/icons-material';
import { templatesApi, mergeApi } from '../api/client';
import type { Template, OutputType } from '../types/api';

// Map of template MIME types to allowed output types
const ALLOWED_OUTPUTS: Record<string, OutputType[]> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['pdf', 'docx', 'html', 'jpg'], // DOCX
  'text/html': ['pdf', 'docx', 'html'], // HTML
  'application/pdf': ['pdf', 'jpg'], // PDF
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'pdf'], // XLSX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 'ppsx', 'pdf', 'jpg'], // PPTX
};

export default function Merge() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    if (!templateId) return;

    try {
      setLoading(true);
      const data = await templatesApi.getById(templateId);
      setTemplate(data);

      // Initialize form data with empty strings for all fields
      const initialData: Record<string, string> = {};
      data.fields.forEach((field) => {
        initialData[field.name] = '';
      });
      setFormData(initialData);

      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load template');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (fieldName: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId || !template) return;

    // Validate all fields are filled
    const emptyFields = Object.entries(formData).filter(([_, value]) => !value.trim());
    if (emptyFields.length > 0) {
      setError(`Please fill in all fields: ${emptyFields.map(([key]) => key).join(', ')}`);
      return;
    }

    try {
      setMerging(true);
      setError('');
      setSuccess('');

      // Determine output type from template default, or fall back to first allowed type or 'pdf'
      const outputType = template.defaultOutputType ||
        (template.mimeType && ALLOWED_OUTPUTS[template.mimeType]?.[0]) ||
        'pdf';

      await mergeApi.mergeSingle(templateId, {
        data: formData,
        outputType,
      });

      setSuccess('Document merged successfully! Redirecting to outputs...');

      // Redirect to outputs page after a short delay
      setTimeout(() => {
        navigate('/outputs');
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Merge failed. Please try again.');
    } finally {
      setMerging(false);
    }
  };

  const handleTestMerge = async () => {
    if (!templateId || !template) return;

    // Validate all fields are filled
    const emptyFields = Object.entries(formData).filter(([_, value]) => !value.trim());
    if (emptyFields.length > 0) {
      setError(`Please fill in all fields: ${emptyFields.map(([key]) => key).join(', ')}`);
      return;
    }

    try {
      setTesting(true);
      setError('');
      setSuccess('');

      // Determine output type from template default
      const outputType = template.defaultOutputType ||
        (template.mimeType && ALLOWED_OUTPUTS[template.mimeType]?.[0]) ||
        'pdf';

      const { blob, filename } = await mergeApi.testMerge(templateId, {
        data: formData,
        outputType,
      });

      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccess('Test document downloaded! This document includes a "TEST - NOT FOR PRODUCTION" footer.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Test merge failed. Please try again.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!template) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="error">Template not found</Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* App Bar */}
      <AppBar position="static">
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => navigate('/templates')}
            sx={{ mr: 2 }}
          >
            <BackIcon />
          </IconButton>
          <Typography variant="h6" component="div">
            Merge Template: {template.displayName}
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h5" component="h1" gutterBottom>
            Fill Template Fields
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 3 }}>
            Enter values for each field to generate your merged document
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
              {success}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            {template.fields.map((field) => (
              <TextField
                key={field.id || field.name}
                fullWidth
                margin="normal"
                label={field.name}
                value={formData[field.name] || ''}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                required
                placeholder={`Enter ${field.name}`}
              />
            ))}

            <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                size="large"
                onClick={handleTestMerge}
                disabled={merging || testing}
                sx={{ flex: 1 }}
              >
                {testing ? 'Testing...' : 'Test Merge'}
              </Button>
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={merging || testing}
                sx={{ flex: 1 }}
              >
                {merging ? 'Merging...' : 'Merge'}
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={() => navigate('/templates')}
                disabled={merging || testing}
              >
                Cancel
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Test Merge downloads a watermarked document without saving to Outputs.
            </Typography>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
