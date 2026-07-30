import React, { useState } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import {
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
import { authApi, getErrorMessage } from '../api/client';

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
    } catch (err: any) {
      setError(getErrorMessage(err, 'Login failed. Please try again.'));
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
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        pb: 8,
        px: 2,
      }}
    >
      {/* Top branding */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, mb: 4 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '12px',
            bgcolor: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Typography sx={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>M</Typography>
        </Box>
        <Box>
          <Typography component="h1" variant="h4" sx={{ color: 'text.primary', lineHeight: 1.2 }}>
            MergeMyDocs
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Document templating, simplified
          </Typography>
        </Box>
      </Box>

      {/* Login form card */}
      <Paper
        sx={{
          p: { xs: 3, sm: 5 },
          width: '100%',
          maxWidth: 420,
          borderRadius: 3,
        }}
      >
        <Typography variant="h5" sx={{ mb: 3, textAlign: 'center' }}>
          Sign In
        </Typography>

        <Box component="form" onSubmit={handleSubmit}>
          {registered && (
            <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
              Account created successfully! Please sign in.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <TextField
            required
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            sx={{ mb: 2 }}
          />

          <PasswordField
            required
            fullWidth
            name="password"
            label="Password"
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            sx={{ mb: 1 }}
          />

          <Box sx={{ textAlign: 'right', mb: 2 }}>
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={() => setForgotPasswordOpen(true)}
              sx={{ color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
            >
              Forgot password?
            </Link>
          </Box>

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={loading}
            sx={{ mb: 2, py: 1.5 }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>

          <Typography variant="body2" sx={{ textAlign: 'center', color: 'text.secondary' }}>
            Don't have an account?{' '}
            <Link
              component={RouterLink}
              to="/register"
              sx={{ color: 'primary.main', fontWeight: 600, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              Sign up
            </Link>
          </Typography>
        </Box>
      </Paper>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotPasswordOpen} onClose={handleCloseForgotPassword} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>Reset Password</DialogTitle>
        <Box component="form" onSubmit={handleForgotPassword}>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter your email address and we'll send you a link to reset your password.
            </Typography>
            {forgotPasswordMessage && (
              <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>
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
    </Box>
  );
}
