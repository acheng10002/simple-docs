/**
 * Map of allowed output types per template MIME type
 */
const ALLOWED_OUTPUTS = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['pdf', 'docx', 'html', 'jpg'],
  'text/html': ['pdf', 'docx', 'html'],
  'application/pdf': ['pdf', 'jpg'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'pdf'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 'ppsx', 'pdf', 'jpg'],
};

module.exports = { ALLOWED_OUTPUTS };
