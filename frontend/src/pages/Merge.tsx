import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
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
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [outputType, setOutputType] = useState<OutputType>('pdf');

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

      // Set default output type based on template format
      const allowedOutputs = data.mimeType ? ALLOWED_OUTPUTS[data.mimeType] : ['pdf'];
      if (allowedOutputs && allowedOutputs.length > 0) {
        setOutputType(allowedOutputs[0]);
      }

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
    if (!templateId) return;

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

      const result = await mergeApi.mergeSingle(templateId, {
        data: formData,
        outputType,
      });

      setSuccess(`Document merged successfully! Job ID: ${result.jobId}`);

      // Download the merged file
      const filePath = result.filePath.replace(/^s3:\/\/[^/]+\//, '');
      const blob = await mergeApi.downloadOutput(filePath);

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `merged-${Date.now()}.${outputType}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // Reset form
      const resetData: Record<string, string> = {};
      template?.fields.forEach((field) => {
        resetData[field.name] = '';
      });
      setFormData(resetData);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Merge failed. Please try again.');
    } finally {
      setMerging(false);
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
                key={field.id}
                fullWidth
                margin="normal"
                label={field.name}
                value={formData[field.name] || ''}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                required
                placeholder={`Enter ${field.name}`}
              />
            ))}

            <FormControl fullWidth margin="normal" sx={{ mt: 3 }}>
              <InputLabel>Output Format</InputLabel>
              <Select
                value={outputType}
                label="Output Format"
                onChange={(e) => setOutputType(e.target.value as OutputType)}
              >
                {(template.mimeType ? ALLOWED_OUTPUTS[template.mimeType] : ['pdf']).map((format) => (
                  <MenuItem key={format} value={format}>
                    {format.toUpperCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={merging}
                fullWidth
              >
                {merging ? 'Merging...' : 'Merge & Download'}
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={() => navigate('/templates')}
              >
                Cancel
              </Button>
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
