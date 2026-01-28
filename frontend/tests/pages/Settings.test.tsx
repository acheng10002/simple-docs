import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Settings from '../../src/pages/Settings';
import { SupabaseAuthProvider } from '../../src/context/SupabaseAuthContext';

// Use vi.hoisted to create mocks that can be used in vi.mock factory
const { mockUpdateEmail, mockUpdatePassword } = vi.hoisted(() => ({
  mockUpdateEmail: vi.fn(),
  mockUpdatePassword: vi.fn(),
}));

// Mock the API client
vi.mock('../../src/api/client', () => ({
  default: {
    post: vi.fn(),
    put: vi.fn(),
  },
  authApi: {
    updateEmail: mockUpdateEmail,
    updatePassword: mockUpdatePassword,
  },
}));

// Mock Supabase
vi.mock('../../src/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: 'test-token',
            user: { id: '1', email: 'current@example.com' },
          },
        },
        error: null,
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
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

const renderSettings = () => {
  return render(
    <BrowserRouter>
      <SupabaseAuthProvider>
        <Settings />
      </SupabaseAuthProvider>
    </BrowserRouter>
  );
};

describe('Settings Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    mockUpdateEmail.mockClear();
    mockUpdatePassword.mockClear();
  });

  describe('Page Rendering', () => {
    it('should render the settings page with correct title', () => {
      renderSettings();

      expect(screen.getByText('Account Settings')).toBeInTheDocument();
      expect(screen.getByText('MergeMyDocs - Settings')).toBeInTheDocument();
    });

    it('should render navigation buttons', () => {
      renderSettings();

      expect(screen.getByRole('button', { name: /templates/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /outputs/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
    });

    it('should render email update section', () => {
      renderSettings();

      expect(screen.getByRole('heading', { name: 'Update Email' })).toBeInTheDocument();
      expect(screen.getByText(/Current Email:/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/new email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /update email/i })).toBeInTheDocument();
    });

    it('should render password update section', () => {
      renderSettings();

      expect(screen.getByRole('heading', { name: 'Update Password' })).toBeInTheDocument();
      expect(screen.getByLabelText('Current Password')).toBeInTheDocument();
      expect(screen.getByLabelText('New Password')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm New Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /update password/i })).toBeInTheDocument();
    });

    it('should render password criteria', () => {
      renderSettings();

      expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
      expect(screen.getByText('At least one uppercase letter')).toBeInTheDocument();
      expect(screen.getByText('At least one lowercase letter')).toBeInTheDocument();
      expect(screen.getByText('At least one number')).toBeInTheDocument();
      expect(screen.getByText('At least one special character')).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should navigate to templates when Templates button is clicked', () => {
      renderSettings();

      const templatesButton = screen.getByRole('button', { name: /templates/i });
      fireEvent.click(templatesButton);

      expect(mockNavigate).toHaveBeenCalledWith('/templates');
    });

    it('should navigate to outputs when Outputs button is clicked', () => {
      renderSettings();

      const outputsButton = screen.getByRole('button', { name: /outputs/i });
      fireEvent.click(outputsButton);

      expect(mockNavigate).toHaveBeenCalledWith('/outputs');
    });

    it('should navigate back to templates when Back button is clicked', () => {
      renderSettings();

      const backButton = screen.getByRole('button', { name: /back/i });
      fireEvent.click(backButton);

      expect(mockNavigate).toHaveBeenCalledWith('/templates');
    });

    it('should navigate to login when Log Out is clicked', async () => {
      renderSettings();

      const logoutButton = screen.getByRole('button', { name: /log out/i });
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Update Email', () => {
    it('should show error when email is empty', async () => {
      renderSettings();

      const updateEmailButton = screen.getByRole('button', { name: /update email/i });
      fireEvent.click(updateEmailButton);

      // Button should be disabled when email is empty
      expect(updateEmailButton).toBeDisabled();
    });

    it('should not call API for invalid email format', async () => {
      renderSettings();

      const emailInput = screen.getByLabelText(/new email/i) as HTMLInputElement;
      fireEvent.change(emailInput, { target: { value: 'invalid-email' } });

      const updateEmailButton = screen.getByRole('button', { name: /update email/i });
      fireEvent.click(updateEmailButton);

      // Wait a bit to ensure no API call happens
      await waitFor(() => {
        expect(mockUpdateEmail).not.toHaveBeenCalled();
      });
    });

    it('should successfully update email', async () => {
      mockUpdateEmail.mockResolvedValue({ message: 'Email updated successfully' });

      renderSettings();

      const emailInput = screen.getByLabelText(/new email/i);
      fireEvent.change(emailInput, { target: { value: 'new@example.com' } });

      const updateEmailButton = screen.getByRole('button', { name: /update email/i });
      fireEvent.click(updateEmailButton);

      await waitFor(() => {
        expect(mockUpdateEmail).toHaveBeenCalledWith('new@example.com');
        expect(screen.getByText(/email updated successfully/i)).toBeInTheDocument();
      });
    });

    it('should show error message on email update failure', async () => {
      mockUpdateEmail.mockRejectedValue({
        response: { data: { error: 'Email is already in use' } },
      });

      renderSettings();

      const emailInput = screen.getByLabelText(/new email/i);
      fireEvent.change(emailInput, { target: { value: 'taken@example.com' } });

      const updateEmailButton = screen.getByRole('button', { name: /update email/i });
      fireEvent.click(updateEmailButton);

      await waitFor(() => {
        expect(screen.getByText('Email is already in use')).toBeInTheDocument();
      });
    });
  });

  describe('Update Password', () => {
    it('should disable update button when current password is empty', () => {
      renderSettings();

      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');

      fireEvent.change(newPasswordInput, { target: { value: 'NewPassword1!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'NewPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      expect(updatePasswordButton).toBeDisabled();
    });

    it('should disable update button when new password is empty', () => {
      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');

      fireEvent.change(currentPasswordInput, { target: { value: 'OldPassword1!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'NewPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      expect(updatePasswordButton).toBeDisabled();
    });

    it('should disable update button when confirm password is empty', () => {
      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');

      fireEvent.change(currentPasswordInput, { target: { value: 'OldPassword1!' } });
      fireEvent.change(newPasswordInput, { target: { value: 'NewPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      expect(updatePasswordButton).toBeDisabled();
    });

    it('should enable update button when all fields are filled', () => {
      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');

      fireEvent.change(currentPasswordInput, { target: { value: 'OldPassword1!' } });
      fireEvent.change(newPasswordInput, { target: { value: 'NewPassword1!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'NewPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      expect(updatePasswordButton).not.toBeDisabled();
    });

    it('should show error when password does not meet requirements', async () => {
      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');

      fireEvent.change(currentPasswordInput, { target: { value: 'OldPassword1!' } });
      fireEvent.change(newPasswordInput, { target: { value: 'weak' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'weak' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      fireEvent.click(updatePasswordButton);

      await waitFor(() => {
        expect(screen.getByText(/does not meet all requirements/i)).toBeInTheDocument();
      });
    });

    it('should show error when passwords do not match', async () => {
      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');

      fireEvent.change(currentPasswordInput, { target: { value: 'OldPassword1!' } });
      fireEvent.change(newPasswordInput, { target: { value: 'NewPassword1!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'DifferentPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      fireEvent.click(updatePasswordButton);

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });

    it('should successfully update password', async () => {
      mockUpdatePassword.mockResolvedValue({ message: 'Password updated successfully' });

      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');

      fireEvent.change(currentPasswordInput, { target: { value: 'OldPassword1!' } });
      fireEvent.change(newPasswordInput, { target: { value: 'NewPassword1!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'NewPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      fireEvent.click(updatePasswordButton);

      await waitFor(() => {
        expect(mockUpdatePassword).toHaveBeenCalledWith('OldPassword1!', 'NewPassword1!');
        expect(screen.getByText(/password updated successfully/i)).toBeInTheDocument();
      });
    });

    it('should show error message on password update failure', async () => {
      mockUpdatePassword.mockRejectedValue({
        response: { data: { error: 'Current password is incorrect' } },
      });

      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');

      fireEvent.change(currentPasswordInput, { target: { value: 'WrongPassword1!' } });
      fireEvent.change(newPasswordInput, { target: { value: 'NewPassword1!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'NewPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      fireEvent.click(updatePasswordButton);

      await waitFor(() => {
        expect(screen.getByText('Current password is incorrect')).toBeInTheDocument();
      });
    });

    it('should clear password fields after successful update', async () => {
      mockUpdatePassword.mockResolvedValue({ message: 'Password updated successfully' });

      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password') as HTMLInputElement;
      const newPasswordInput = screen.getByLabelText('New Password') as HTMLInputElement;
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password') as HTMLInputElement;

      fireEvent.change(currentPasswordInput, { target: { value: 'OldPassword1!' } });
      fireEvent.change(newPasswordInput, { target: { value: 'NewPassword1!' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'NewPassword1!' } });

      const updatePasswordButton = screen.getByRole('button', { name: /update password/i });
      fireEvent.click(updatePasswordButton);

      await waitFor(() => {
        expect(currentPasswordInput.value).toBe('');
        expect(newPasswordInput.value).toBe('');
        expect(confirmPasswordInput.value).toBe('');
      });
    });
  });

  describe('Password Visibility Toggle', () => {
    it('should toggle current password visibility', () => {
      renderSettings();

      const currentPasswordInput = screen.getByLabelText('Current Password') as HTMLInputElement;
      expect(currentPasswordInput.type).toBe('password');

      const toggleButtons = screen.getAllByRole('button', { name: /toggle.*password visibility/i });
      fireEvent.click(toggleButtons[0]); // First toggle is for current password

      expect(currentPasswordInput.type).toBe('text');

      fireEvent.click(toggleButtons[0]);
      expect(currentPasswordInput.type).toBe('password');
    });

    it('should toggle new password visibility', () => {
      renderSettings();

      const newPasswordInput = screen.getByLabelText('New Password') as HTMLInputElement;
      expect(newPasswordInput.type).toBe('password');

      const toggleButtons = screen.getAllByRole('button', { name: /toggle.*password visibility/i });
      fireEvent.click(toggleButtons[1]); // Second toggle is for new password

      expect(newPasswordInput.type).toBe('text');
    });

    it('should toggle confirm password visibility', () => {
      renderSettings();

      const confirmPasswordInput = screen.getByLabelText('Confirm New Password') as HTMLInputElement;
      expect(confirmPasswordInput.type).toBe('password');

      const toggleButtons = screen.getAllByRole('button', { name: /toggle.*password visibility/i });
      fireEvent.click(toggleButtons[2]); // Third toggle is for confirm password

      expect(confirmPasswordInput.type).toBe('text');
    });
  });

  describe('Password Criteria Visual Feedback', () => {
    it('should show all criteria as not met for empty password', () => {
      renderSettings();

      const closeIcons = document.querySelectorAll('[data-testid="CloseIcon"]');
      expect(closeIcons.length).toBe(5);
    });

    it('should update criteria as password is typed', async () => {
      renderSettings();

      const newPasswordInput = screen.getByLabelText('New Password');

      // Type a password that meets all criteria
      fireEvent.change(newPasswordInput, { target: { value: 'Password1!' } });

      await waitFor(() => {
        const checkIcons = document.querySelectorAll('[data-testid="CheckIcon"]');
        expect(checkIcons.length).toBe(5);
      });
    });

    it('should show partial criteria met', async () => {
      renderSettings();

      const newPasswordInput = screen.getByLabelText('New Password');

      // Type a password that only meets some criteria (lowercase only)
      fireEvent.change(newPasswordInput, { target: { value: 'abc' } });

      await waitFor(() => {
        const checkIcons = document.querySelectorAll('[data-testid="CheckIcon"]');
        const closeIcons = document.querySelectorAll('[data-testid="CloseIcon"]');
        expect(checkIcons.length).toBe(1); // Only lowercase met
        expect(closeIcons.length).toBe(4);
      });
    });
  });
});
