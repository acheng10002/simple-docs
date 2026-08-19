import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, TextField, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';

const primary = '#2e72c2';
const primaryDark = '#1a4a8a';
const textColor = '#1a2138';
const textSecondary = '#566d92';
const bgColor = '#f5f7fa';

const features = [
  {
    title: 'Format flexibility',
    desc: '5 template formats, 7 output formats. DOCX, HTML, PDF, XLSX, PPTX in — PDF, DOCX, HTML, XLSX, PPTX, PPSX, JPG out.',
  },
  {
    title: 'Simple setup',
    desc: 'Upload a template with {{placeholders}}, send data, get your document. No drag-and-drop builder to learn.',
  },
  {
    title: 'Batch processing',
    desc: 'Upload a CSV to merge hundreds of documents at once. Small batches run inline; large ones process in the background.',
  },
  {
    title: 'API & webhooks',
    desc: 'Integrate with any system via REST API or HMAC-signed webhooks. No middleware dependency required.',
  },
  {
    title: 'Self-hostable',
    desc: 'Deploy on your own infrastructure with Docker. Full control over your data for teams with residency requirements.',
  },
  {
    title: 'Competitive pricing',
    desc: 'Straightforward plans designed to undercut the incumbents. Details coming soon.',
  },
];

const formats = [
  { template: 'DOCX', outputs: 'PDF, DOCX, HTML, JPG' },
  { template: 'HTML', outputs: 'PDF, DOCX, HTML' },
  { template: 'PDF', outputs: 'PDF, JPG' },
  { template: 'XLSX', outputs: 'XLSX, PDF' },
  { template: 'PPTX', outputs: 'PPTX, PPSX, PDF, JPG' },
];

const steps = [
  { num: '1', title: 'Upload your template', desc: 'Upload a DOCX, HTML, PDF, XLSX, or PPTX file with {{placeholders}} where your data goes.' },
  { num: '2', title: 'Send your data', desc: 'Fill in field values manually, upload a CSV for batch processing, or trigger merges via the API or webhooks.' },
  { num: '3', title: 'Get your document', desc: 'Download your merged document in PDF, DOCX, HTML, XLSX, PPTX, PPSX, or JPG — whatever you need.' },
];

export default function Landing() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
      setEmail('');
    }
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const navLink = {
    fontSize: '0.875rem',
    color: textSecondary,
    cursor: 'pointer',
    textDecoration: 'none',
    '&:hover': { color: textColor },
    transition: 'color 0.2s',
  };

  return (
    <Box sx={{ bgcolor: '#fff', color: textColor }}>
      {/* Nav */}
      <Box
        component="nav"
        sx={{
          position: 'fixed',
          top: 0,
          width: '100%',
          bgcolor: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid',
          borderColor: 'grey.100',
          zIndex: 50,
        }}
      >
        <Box sx={{ maxWidth: 1152, mx: 'auto', px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 32, height: 32, borderRadius: '8px', bgcolor: primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>M</Typography>
            </Box>
            <Typography sx={{ fontSize: '1.125rem', fontWeight: 600, color: textColor }}>MergeMyDocs</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Typography component="a" onClick={() => scrollTo('features')} sx={navLink}>Features</Typography>
            <Typography component="a" onClick={() => scrollTo('how-it-works')} sx={navLink}>How It Works</Typography>
            <Typography component="a" onClick={() => scrollTo('pricing')} sx={navLink}>Pricing</Typography>
            <Button variant="contained" size="small" onClick={() => scrollTo('waitlist')} sx={{ bgcolor: primary, '&:hover': { bgcolor: primaryDark } }}>
              Get Early Access
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Hero */}
      <Box id="waitlist" sx={{ pt: 16, pb: 10, px: 3 }}>
        <Box sx={{ maxWidth: 720, mx: 'auto', textAlign: 'center' }}>
          <Typography variant="h3" sx={{ fontWeight: 700, color: textColor, lineHeight: 1.2, letterSpacing: '-0.02em', mb: 3 }}>
            Document templating,<br />simplified.
          </Typography>
          <Typography sx={{ fontSize: '1.25rem', color: textSecondary, mb: 5, maxWidth: 600, mx: 'auto', lineHeight: 1.6 }}>
            Upload a template, fill its placeholders with your data, and export to the format you need. Single records or thousands via CSV — MergeMyDocs handles it.
          </Typography>
          <Box component="form" onSubmit={handleWaitlist} sx={{ display: 'flex', gap: 1.5, maxWidth: 420, mx: 'auto' }}>
            {submitted ? (
              <Box sx={{ width: '100%', bgcolor: '#f0fdf4', color: '#15803d', py: 1.5, px: 2, borderRadius: 2, fontSize: '0.875rem', fontWeight: 500 }}>
                You're on the list! We'll be in touch.
              </Box>
            ) : (
              <>
                <TextField
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  size="small"
                  sx={{ flex: 1 }}
                />
                <Button type="submit" variant="contained" sx={{ bgcolor: primary, '&:hover': { bgcolor: primaryDark }, whiteSpace: 'nowrap' }}>
                  Get Early Access
                </Button>
              </>
            )}
          </Box>
        </Box>
      </Box>

      {/* How It Works */}
      <Box id="how-it-works" sx={{ py: 10, px: 3, bgcolor: bgColor }}>
        <Box sx={{ maxWidth: 960, mx: 'auto' }}>
          <Typography variant="h4" sx={{ fontWeight: 700, textAlign: 'center', color: textColor, mb: 2 }}>How it works</Typography>
          <Typography sx={{ color: textSecondary, textAlign: 'center', mb: 7, maxWidth: 500, mx: 'auto' }}>
            Three steps. No builder to learn, no complex setup.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 5 }}>
            {steps.map((step) => (
              <Box key={step.num} sx={{ textAlign: 'center' }}>
                <Box sx={{ width: 56, height: 56, borderRadius: 4, bgcolor: `${primary}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2.5 }}>
                  <Typography sx={{ color: primary, fontSize: '1.5rem', fontWeight: 700 }}>{step.num}</Typography>
                </Box>
                <Typography sx={{ fontWeight: 600, fontSize: '1.125rem', mb: 1, color: textColor }}>{step.title}</Typography>
                <Typography sx={{ color: textSecondary, fontSize: '0.875rem', lineHeight: 1.6 }}>{step.desc}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Features */}
      <Box id="features" sx={{ py: 10, px: 3 }}>
        <Box sx={{ maxWidth: 960, mx: 'auto' }}>
          <Typography variant="h4" sx={{ fontWeight: 700, textAlign: 'center', color: textColor, mb: 2 }}>Built for teams that merge documents</Typography>
          <Typography sx={{ color: textSecondary, textAlign: 'center', mb: 7, maxWidth: 500, mx: 'auto' }}>
            Everything you need to automate document generation — without the complexity.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 4 }}>
            {features.map((feature) => (
              <Box key={feature.title} sx={{ bgcolor: bgColor, borderRadius: 3, p: 3 }}>
                <Typography sx={{ fontWeight: 600, color: textColor, mb: 1 }}>{feature.title}</Typography>
                <Typography sx={{ color: textSecondary, fontSize: '0.875rem', lineHeight: 1.6 }}>{feature.desc}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Format Support */}
      <Box sx={{ py: 10, px: 3, bgcolor: bgColor }}>
        <Box sx={{ maxWidth: 720, mx: 'auto' }}>
          <Typography variant="h4" sx={{ fontWeight: 700, textAlign: 'center', color: textColor, mb: 2 }}>Output formats by template type</Typography>
          <Typography sx={{ color: textSecondary, textAlign: 'center', mb: 5 }}>Upload in one format, export in another.</Typography>
          <TableContainer sx={{ bgcolor: '#fff', borderRadius: 3, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600, color: textSecondary }}>Template</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: textSecondary }}>Available outputs</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {formats.map((row) => (
                  <TableRow key={row.template}>
                    <TableCell sx={{ fontWeight: 500, color: textColor }}>{row.template}</TableCell>
                    <TableCell sx={{ color: textSecondary }}>{row.outputs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Box>

      {/* Pricing */}
      <Box id="pricing" sx={{ py: 10, px: 3 }}>
        <Box sx={{ maxWidth: 720, mx: 'auto', textAlign: 'center' }}>
          <Typography variant="h4" sx={{ fontWeight: 700, color: textColor, mb: 2 }}>Pricing</Typography>
          <Typography sx={{ color: textSecondary, mb: 5, maxWidth: 500, mx: 'auto' }}>
            Simple, transparent plans — built to give you more value than the alternatives. Details coming soon.
          </Typography>
          <Box sx={{ bgcolor: bgColor, borderRadius: 3, p: 5 }}>
            <Typography sx={{ color: textSecondary, fontSize: '1.125rem', mb: 3 }}>Pricing plans are being finalized.</Typography>
            <Button variant="contained" onClick={() => scrollTo('contact')} sx={{ bgcolor: primary, '&:hover': { bgcolor: primaryDark } }}>
              Get notified when we launch
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Contact */}
      <Box id="contact" sx={{ py: 10, px: 3, bgcolor: bgColor }}>
        <Box sx={{ maxWidth: 720, mx: 'auto' }}>
          <Typography variant="h4" sx={{ fontWeight: 700, textAlign: 'center', color: textColor, mb: 2 }}>Get in touch</Typography>
          <Typography sx={{ color: textSecondary, textAlign: 'center', mb: 5 }}>Interested in MergeMyDocs? We'd love to hear from you.</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
            <Box sx={{ bgcolor: '#fff', borderRadius: 3, p: 4, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 600, color: textColor, mb: 1 }}>Request a demo</Typography>
              <Typography sx={{ color: textSecondary, fontSize: '0.875rem', mb: 2 }}>See MergeMyDocs in action with a personalized walkthrough.</Typography>
              <Button variant="contained" href="mailto:demo@mergemydocs.com" sx={{ bgcolor: primary, '&:hover': { bgcolor: primaryDark } }}>
                Request a Demo
              </Button>
            </Box>
            <Box sx={{ bgcolor: '#fff', borderRadius: 3, p: 4, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 600, color: textColor, mb: 1 }}>Contact sales</Typography>
              <Typography sx={{ color: textSecondary, fontSize: '0.875rem', mb: 2 }}>Have questions about pricing, enterprise features, or self-hosting?</Typography>
              <Button variant="outlined" href="mailto:sales@mergemydocs.com" sx={{ borderColor: primary, color: primary, '&:hover': { bgcolor: primary, color: '#fff' } }}>
                Contact Sales
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Footer */}
      <Box component="footer" sx={{ py: 5, px: 3, borderTop: '1px solid', borderColor: 'grey.100' }}>
        <Box sx={{ maxWidth: 960, mx: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 28, height: 28, borderRadius: '6px', bgcolor: primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>M</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: textColor }}>MergeMyDocs</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: textSecondary }}>&copy; {new Date().getFullYear()} MergeMyDocs. All rights reserved.</Typography>
        </Box>
      </Box>
    </Box>
  );
}
