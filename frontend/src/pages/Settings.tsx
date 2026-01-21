import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Alert,
  AppBar,
  Toolbar,
  Divider,
  CircularProgress,
  IconButton,
  InputAdornment,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Folder as TemplatesIcon,
  Folder as OutputsIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { useAuth } from '../context/SupabaseAuthContext';
import { authApi } from '../api/client';
import PasswordCriteria, { validatePassword } from '../components/PasswordCriteria';

export default function Settings() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  // Email update state
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');

  // Password update state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');

    if (!newEmail.trim()) {
      setEmailError('Email is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      setEmailError('Invalid email format');
      return;
    }

    try {
      setEmailLoading(true);
      await authApi.updateEmail(newEmail);
      setEmailSuccess('Email updated successfully. Please log in again with your new email.');
      setNewEmail('');
      // Log out after email change since session may be invalidated
      setTimeout(() => {
        logout();
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      setEmailError(err.response?.data?.error || 'Failed to update email');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Current password is required');
      return;
    }

    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }

    if (!validatePassword(newPassword)) {
      setPasswordError('New password does not meet all requirements');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    try {
      setPasswordLoading(true);
      await authApi.updatePassword(currentPassword, newPassword);
      setPasswordSuccess('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* App Bar */}
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            MergeMyDocs - Settings
          </Typography>
          <Button
            color="inherit"
            startIcon={<TemplatesIcon />}
            onClick={() => navigate('/templates')}
            sx={{ mr: 2 }}
          >
            Templates
          </Button>
          <Button
            color="inherit"
            startIcon={<OutputsIcon />}
            onClick={() => navigate('/outputs')}
            sx={{ mr: 2 }}
          >
            Outputs
          </Button>
          <Typography variant="body2" sx={{ mr: 2 }}>
            {user?.email}
          </Typography>
          <Button color="inherit" onClick={handleLogout}>
            Log Out
          </Button>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate('/templates')}
              sx={{ mr: 2 }}
            >
              Back
            </Button>
            <Typography variant="h5" component="h1">
              Account Settings
            </Typography>
          </Box>

          {/* Email Update Section */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Update Email
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              Current Email: {user?.email}
            </Typography>

            {emailError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setEmailError('')}>
                {emailError}
              </Alert>
            )}

            {emailSuccess && (
              <Alert severity="success" sx={{ mb: 2 }} onClose={() => setEmailSuccess('')}>
                {emailSuccess}
              </Alert>
            )}

            <form onSubmit={handleUpdateEmail}>
              <TextField
                fullWidth
                label="New Email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                sx={{ mb: 2 }}
                disabled={emailLoading}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={emailLoading || !newEmail.trim()}
              >
                {emailLoading ? <CircularProgress size={24} /> : 'Update Email'}
              </Button>
            </form>
          </Box>

          <Divider sx={{ mb: 4 }} />

          {/* Password Update Section */}
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Update Password
            </Typography>

            {passwordError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPasswordError('')}>
                {passwordError}
              </Alert>
            )}

            {passwordSuccess && (
              <Alert severity="success" sx={{ mb: 2 }} onClose={() => setPasswordSuccess('')}>
                {passwordSuccess}
              </Alert>
            )}

            <form onSubmit={handleUpdatePassword}>
              <TextField
                fullWidth
                label="Current Password"
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                sx={{ mb: 2 }}
                disabled={passwordLoading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle current password visibility"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        edge="end"
                      >
                        {showCurrentPassword ? <Visibility /> : <VisibilityOff />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                fullWidth
                label="New Password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle new password visibility"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        edge="end"
                      >
                        {showNewPassword ? <Visibility /> : <VisibilityOff />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <PasswordCriteria password={newPassword} />
              <TextField
                fullWidth
                label="Confirm New Password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                sx={{ mb: 2 }}
                disabled={passwordLoading}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle confirm password visibility"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        edge="end"
                      >
                        {showConfirmPassword ? <Visibility /> : <VisibilityOff />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
              >
                {passwordLoading ? <CircularProgress size={24} /> : 'Update Password'}
              </Button>
            </form>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
