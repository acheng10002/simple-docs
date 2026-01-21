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
import { ArrowBack as BackIcon, CloudUpload as UploadIcon } from '@mui/icons-material';
import { templatesApi } from '../api/client';
import type { Template, OutputType, PageSize, Orientation } from '../types/api';
import VersionHistory from '../components/VersionHistory';

// Map of template MIME types to allowed output types
const ALLOWED_OUTPUTS: Record<string, OutputType[]> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['pdf', 'docx', 'html', 'jpg'], // DOCX
  'text/html': ['pdf', 'docx', 'html'], // HTML
  'application/pdf': ['pdf', 'jpg'], // PDF
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'pdf'], // XLSX
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 'ppsx', 'pdf', 'jpg'], // PPTX
};

export default function EditTemplate() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form fields
  const [displayName, setDisplayName] = useState('');
  const [defaultOutputType, setDefaultOutputType] = useState<OutputType | ''>('');
  const [outputNameFormat, setOutputNameFormat] = useState('');
  const [pageSize, setPageSize] = useState<PageSize | ''>('');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [replacementFile, setReplacementFile] = useState<File | null>(null);

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    if (!templateId) return;

    try {
      setLoading(true);
      const data = await templatesApi.getById(templateId);
      setTemplate(data);

      // Initialize form fields with current values
      setDisplayName(data.displayName);
      setDefaultOutputType(data.defaultOutputType || '');
      setOutputNameFormat(data.outputNameFormat || '');
      setPageSize(data.pageSize || '');
      setOrientation(data.orientation || 'portrait');

      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load template');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      event.target.value = '';
      return;
    }

    setReplacementFile(file);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId || !template) return;

    // Validate display name
    if (!displayName.trim()) {
      setError('Template name is required');
      return;
    }

    // Validate output name format is selected
    if (!outputNameFormat) {
      setError('Please select a field to append to the output file name');
      return;
    }

    // Validate output file type is selected
    if (!defaultOutputType) {
      setError('Please select an output file type');
      return;
    }

    // Validate page size is selected
    if (!pageSize) {
      setError('Please select a page size');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      // Call update API
      await templatesApi.update(templateId, {
        displayName: displayName.trim(),
        defaultOutputType: defaultOutputType || null,
        outputNameFormat: outputNameFormat || null,
        pageSize: pageSize || null,
        orientation: orientation || null,
        file: replacementFile || undefined,
      });

      setSuccess('Template updated successfully!');

      // Navigate back to templates after a short delay
      setTimeout(() => {
        navigate('/templates');
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update template');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/templates');
  };

  const handleDeactivate = async () => {
    if (!templateId || !template) return;

    if (!window.confirm(`Are you sure you want to deactivate the template "${template.displayName}"? This will hide it from your templates list, but all merge outputs will be preserved. You can reactivate it later if needed.`)) {
      return;
    }

    try {
      await templatesApi.delete(templateId);
      navigate('/templates');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to deactivate template');
    }
  };

  const handleVersionRevert = async () => {
    await loadTemplate();
    setSuccess('Template reverted successfully!');
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
            onClick={handleCancel}
            sx={{ mr: 2 }}
          >
            <BackIcon />
          </IconButton>
          <Typography variant="h6" component="div">
            Edit Template: {template.displayName}
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h5" component="h1" gutterBottom>
            Edit Template
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 3 }}>
            Update template name, default output type, and output filename format
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
            {/* Template Name */}
            <TextField
              fullWidth
              margin="normal"
              label="Template Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              placeholder="Enter template name"
            />

            {/* Output File Type */}
            <FormControl fullWidth margin="normal" sx={{ mt: 2 }} required>
              <InputLabel>Output File Type</InputLabel>
              <Select
                value={defaultOutputType}
                label="Output File Type"
                onChange={(e) => setDefaultOutputType(e.target.value as OutputType)}
                required
              >
                {(template.mimeType ? ALLOWED_OUTPUTS[template.mimeType] : ['pdf']).map((type) => (
                  <MenuItem key={type} value={type}>
                    {type.toUpperCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Page Size */}
            <FormControl fullWidth margin="normal" sx={{ mt: 2 }} required>
              <InputLabel>Page Size</InputLabel>
              <Select
                value={pageSize}
                label="Page Size"
                onChange={(e) => setPageSize(e.target.value as PageSize)}
                required
              >
                <MenuItem value="letter">Letter (8.5" x 11")</MenuItem>
                <MenuItem value="legal">Legal (8.5" x 14")</MenuItem>
                <MenuItem value="a4">A4 (210mm x 297mm)</MenuItem>
                <MenuItem value="a3">A3 (297mm x 420mm)</MenuItem>
                <MenuItem value="tabloid">Tabloid (11" x 17")</MenuItem>
              </Select>
            </FormControl>

            {/* Orientation */}
            <FormControl fullWidth margin="normal" sx={{ mt: 2 }} required>
              <InputLabel>Orientation</InputLabel>
              <Select
                value={orientation}
                label="Orientation"
                onChange={(e) => setOrientation(e.target.value as Orientation)}
                required
              >
                <MenuItem value="portrait">Portrait</MenuItem>
                <MenuItem value="landscape">Landscape</MenuItem>
              </Select>
            </FormControl>

            {/* Output Filename */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom sx={{ mb: 1, display: 'block', ml: 1.75 }}>
                Output Filename *
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, ml: 1.75 }}>
                <Typography variant="body1">
                  {(displayName || 'TemplateName').replace(/\.[^.]+$/, '')}-
                </Typography>
                <FormControl sx={{ flex: 1 }} required>
                  <InputLabel>Field to Append</InputLabel>
                  <Select
                    value={outputNameFormat}
                    label="Field to Append"
                    onChange={(e) => setOutputNameFormat(e.target.value)}
                    required
                    displayEmpty
                  >
                    {template.fields.map((field) => (
                      <MenuItem key={field.id} value={field.name}>
                        {field.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="body1">
                  .{defaultOutputType || 'pdf'}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, ml: 1.75 }}>
                {outputNameFormat && '(incremental counter added if duplicate)'}
              </Typography>
            </Box>

            {/* Replace Template File */}
            <Box sx={{ mt: 3 }}>
              <Button
                variant="outlined"
                component="label"
                startIcon={<UploadIcon />}
                fullWidth
              >
                {replacementFile ? `Selected: ${replacementFile.name}` : 'Replace Template File (Optional)'}
                <input
                  type="file"
                  hidden
                  accept=".docx,.html,.pdf,.xlsx,.pptx"
                  onChange={handleFileChange}
                />
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Upload a new file to replace the current template. Leave empty to keep the existing file.
              </Typography>
            </Box>

            {/* Action Buttons */}
            <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={saving}
                fullWidth
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </Button>
            </Box>

            {/* Version History Section */}
            {templateId && (
              <VersionHistory
                templateId={templateId}
                onRevertSuccess={handleVersionRevert}
              />
            )}

            {/* Deactivate Template Button */}
            <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
              <Button
                variant="outlined"
                color="error"
                size="large"
                onClick={handleDeactivate}
                disabled={saving}
                fullWidth
              >
                Deactivate Template
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
                This will hide the template from your list. Merge outputs will be preserved.
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
