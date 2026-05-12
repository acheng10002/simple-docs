import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Button,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { supabase } from '../config/supabase';
import { authApi } from '../api/client';
import PasswordCriteria, { validatePassword } from '../components/PasswordCriteria';
import PasswordField from '../components/PasswordField';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [validatingSession, setValidatingSession] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    // Handle the password reset callback from Supabase
    const handleAuthCallback = async () => {
      try {
        // Check for hash fragment from Supabase redirect
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessTokenFromHash = hashParams.get('access_token');
        const type = hashParams.get('type');

        if (accessTokenFromHash && type === 'recovery') {
          setAccessToken(accessTokenFromHash);
          setValidatingSession(false);
          return;
        }

        // Also check for existing session (in case page was refreshed)
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          setAccessToken(session.access_token);
          setValidatingSession(false);
          return;
        }

        // No valid session found
        setError('Invalid or expired password reset link. Please request a new one.');
        setValidatingSession(false);
      } catch {
        setError('Failed to validate reset link. Please try again.');
        setValidatingSession(false);
      }
    };

    handleAuthCallback();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!validatePassword(password)) {
      setError('Password does not meet all requirements');
      return;
    }

    if (!accessToken) {
      setError('Invalid session. Please request a new password reset link.');
      return;
    }

    setLoading(true);

    try {
      const response = await authApi.resetPassword(password, accessToken);
      setSuccess(response.message);
      // Redirect to login after 3 seconds
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (validatingSession) {
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
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Validating reset link...</Typography>
        </Box>
      </Container>
    );
  }

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
            Reset Password
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Enter your new password below
          </Typography>

          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 3, width: '100%' }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            {success && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {success}
              </Alert>
            )}

            {!success && accessToken && (
              <>
                <PasswordField
                  margin="normal"
                  required
                  fullWidth
                  name="password"
                  label="New Password"
                  id="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <PasswordCriteria password={password} />

                <PasswordField
                  margin="normal"
                  required
                  fullWidth
                  name="confirmPassword"
                  label="Confirm New Password"
                  id="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />

                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{ mt: 3, mb: 2 }}
                  disabled={loading}
                >
                  {loading ? 'Resetting...' : 'Reset Password'}
                </Button>
              </>
            )}

            <Box sx={{ textAlign: 'center' }}>
              <Button
                variant="text"
                onClick={() => navigate('/login')}
                sx={{ textTransform: 'none' }}
              >
                Back to Login
              </Button>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
}
