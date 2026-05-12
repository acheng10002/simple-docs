import React, { useState } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Link,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { useAuth } from '../context/SupabaseAuthContext';
import PasswordField from '../components/PasswordField';
import { authApi } from '../api/client';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const registered = location.state?.registered;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login({ email, password });
      navigate('/templates');
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotPasswordLoading(true);
    setForgotPasswordMessage('');

    try {
      const response = await authApi.forgotPassword(forgotPasswordEmail);
      setForgotPasswordMessage(response.message);
      setForgotPasswordEmail('');
    } catch {
      // Still show success message to prevent email enumeration
      setForgotPasswordMessage('If an account exists with this email, a password reset link has been sent.');
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  const handleCloseForgotPassword = () => {
    setForgotPasswordOpen(false);
    setForgotPasswordEmail('');
    setForgotPasswordMessage('');
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Paper
          elevation={3}
          sx={{
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <Typography component="h1" variant="h4" gutterBottom>
            MergeMyDocs
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Sign in to merge your documents
          </Typography>

          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 3, width: '100%' }}>
            {registered && (
              <Alert severity="success" sx={{ mb: 2 }}>
                Account created successfully! Please sign in.
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <TextField
              margin="normal"
              required
              fullWidth
              id="email"
              label="Email Address"
              name="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <PasswordField
              margin="normal"
              required
              fullWidth
              name="password"
              label="Password"
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>

            <Box sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => setForgotPasswordOpen(true)}
                sx={{ cursor: 'pointer' }}
              >
                Forgot password?
              </Link>
              <Link component={RouterLink} to="/register" variant="body2">
                Don't have an account? Sign up
              </Link>
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotPasswordOpen} onClose={handleCloseForgotPassword} maxWidth="xs" fullWidth>
        <DialogTitle>Reset Password</DialogTitle>
        <Box component="form" onSubmit={handleForgotPassword}>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter your email address and we'll send you a link to reset your password.
            </Typography>
            {forgotPasswordMessage && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {forgotPasswordMessage}
              </Alert>
            )}
            <TextField
              autoFocus
              fullWidth
              label="Email Address"
              type="email"
              value={forgotPasswordEmail}
              onChange={(e) => setForgotPasswordEmail(e.target.value)}
              disabled={forgotPasswordLoading || !!forgotPasswordMessage}
              required
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseForgotPassword}>
              {forgotPasswordMessage ? 'Close' : 'Cancel'}
            </Button>
            {!forgotPasswordMessage && (
              <Button
                type="submit"
                variant="contained"
                disabled={forgotPasswordLoading || !forgotPasswordEmail}
              >
                {forgotPasswordLoading ? 'Sending...' : 'Send Reset Link'}
              </Button>
            )}
          </DialogActions>
        </Box>
      </Dialog>
    </Container>
  );
}
