import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import ResetPassword from '../../src/pages/ResetPassword';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  authApi: {
    resetPassword: vi.fn(),
  },
}));

// Mock Supabase
vi.mock('../../src/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { authApi } from '../../src/api/client';
import { supabase } from '../../src/config/supabase';

const renderResetPassword = (hash = '') => {
  // Set the hash fragment for the test
  window.location.hash = hash;

  return render(
    <BrowserRouter>
      <ResetPassword />
    </BrowserRouter>
  );
};

// Helper to get password inputs by id
const getPasswordInput = () => document.getElementById('password') as HTMLInputElement;
const getConfirmPasswordInput = () => document.getElementById('confirmPassword') as HTMLInputElement;

describe('ResetPassword Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    window.location.hash = '';
  });

  describe('Validation', () => {
    it('should show validating message initially', () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      renderResetPassword();

      expect(screen.getByText(/validating reset link/i)).toBeInTheDocument();
    });

    it('should show error when no valid token is found', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      renderResetPassword();

      await waitFor(() => {
        expect(screen.getByText(/invalid or expired password reset link/i)).toBeInTheDocument();
      });
    });

    it('should show form when valid recovery token is in hash', async () => {
      renderResetPassword('#access_token=valid-token&type=recovery');

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Reset Password' })).toBeInTheDocument();
        expect(getPasswordInput()).toBeInTheDocument();
        expect(getConfirmPasswordInput()).toBeInTheDocument();
      });
    });

    it('should show form when valid session exists', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            access_token: 'session-token',
          },
        },
        error: null,
      });

      renderResetPassword();

      await waitFor(() => {
        expect(getPasswordInput()).toBeInTheDocument();
      });
    });
  });

  describe('Password Reset Form', () => {
    it('should show error when passwords do not match', async () => {
      renderResetPassword('#access_token=valid-token&type=recovery');

      await waitFor(() => {
        expect(getPasswordInput()).toBeInTheDocument();
      });

      fireEvent.change(getPasswordInput(), { target: { value: 'newPassword123' } });
      fireEvent.change(getConfirmPasswordInput(), { target: { value: 'differentPassword' } });

      const submitButton = screen.getByRole('button', { name: /reset password/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });

    it('should show error when password is too short', async () => {
      renderResetPassword('#access_token=valid-token&type=recovery');

      await waitFor(() => {
        expect(getPasswordInput()).toBeInTheDocument();
      });

      fireEvent.change(getPasswordInput(), { target: { value: 'short' } });
      fireEvent.change(getConfirmPasswordInput(), { target: { value: 'short' } });

      const submitButton = screen.getByRole('button', { name: /reset password/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
      });
    });

    it('should handle successful password reset', async () => {
      vi.mocked(authApi.resetPassword).mockResolvedValue({
        message: 'Password has been reset successfully.',
      });

      renderResetPassword('#access_token=valid-token&type=recovery');

      await waitFor(() => {
        expect(getPasswordInput()).toBeInTheDocument();
      });

      fireEvent.change(getPasswordInput(), { target: { value: 'newPassword123' } });
      fireEvent.change(getConfirmPasswordInput(), { target: { value: 'newPassword123' } });

      const submitButton = screen.getByRole('button', { name: /reset password/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(authApi.resetPassword).toHaveBeenCalledWith('newPassword123', 'valid-token');
        expect(screen.getByText(/password has been reset successfully/i)).toBeInTheDocument();
      });
    });

    it('should display error message on reset failure', async () => {
      const errorMessage = 'Failed to reset password';
      vi.mocked(authApi.resetPassword).mockRejectedValue({
        response: { data: { error: errorMessage } },
      });

      renderResetPassword('#access_token=valid-token&type=recovery');

      await waitFor(() => {
        expect(getPasswordInput()).toBeInTheDocument();
      });

      fireEvent.change(getPasswordInput(), { target: { value: 'newPassword123' } });
      fireEvent.change(getConfirmPasswordInput(), { target: { value: 'newPassword123' } });

      const submitButton = screen.getByRole('button', { name: /reset password/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });

    it('should disable form while loading', async () => {
      vi.mocked(authApi.resetPassword).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      renderResetPassword('#access_token=valid-token&type=recovery');

      await waitFor(() => {
        expect(getPasswordInput()).toBeInTheDocument();
      });

      fireEvent.change(getPasswordInput(), { target: { value: 'newPassword123' } });
      fireEvent.change(getConfirmPasswordInput(), { target: { value: 'newPassword123' } });

      const submitButton = screen.getByRole('button', { name: /reset password/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
        expect(screen.getByText(/resetting/i)).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('should have back to login button', async () => {
      (supabase.auth.getSession as any).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      renderResetPassword();

      await waitFor(() => {
        const backButton = screen.getByRole('button', { name: /back to login/i });
        expect(backButton).toBeInTheDocument();
      });

      const backButton = screen.getByRole('button', { name: /back to login/i });
      fireEvent.click(backButton);

      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });
});
