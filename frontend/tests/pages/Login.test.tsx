import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Login from '../../src/pages/Login';
import { SupabaseAuthProvider } from '../../src/context/SupabaseAuthContext';

// Use vi.hoisted to create mocks that can be used in vi.mock factory
const { mockPost, mockForgotPassword, mockGetSession, mockSetSession } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockForgotPassword: vi.fn(),
  mockGetSession: vi.fn(),
  mockSetSession: vi.fn(),
}));

// Mock the API client
vi.mock('../../src/api/client', () => ({
  default: {
    post: mockPost,
  },
  authApi: {
    login: vi.fn(),
    forgotPassword: mockForgotPassword,
  },
}));

// Mock Supabase
vi.mock('../../src/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      setSession: mockSetSession,
      signOut: vi.fn(),
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

const renderLogin = async () => {
  const result = render(
    <BrowserRouter>
      <SupabaseAuthProvider>
        <Login />
      </SupabaseAuthProvider>
    </BrowserRouter>
  );
  // Wait for auth context to finish loading
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
  return result;
};

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    mockPost.mockClear();
    mockForgotPassword.mockClear();
    // Setup default mock for getSession
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockSetSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  it('should render login form', async () => {
    const { container } = await renderLogin();

    expect(screen.getByText('MergeMyDocs')).toBeInTheDocument();
    expect(container.querySelector('#email')).toBeInTheDocument();
    expect(container.querySelector('#password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should show validation errors for empty fields', async () => {
    const { container } = await renderLogin();

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitButton);

    // HTML5 validation will prevent submission
    const emailInput = container.querySelector('#email') as HTMLInputElement;
    expect(emailInput.validity.valid).toBe(false);
  });

  it('should handle successful login', async () => {
    const mockResponse = {
      data: {
        session: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
        },
        user: { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' },
      },
    };

    mockPost.mockResolvedValue(mockResponse);

    const { container } = await renderLogin();

    const emailInput = container.querySelector('#email')!;
    const passwordInput = container.querySelector('#password')!;
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/auth/login', {
        email: 'test@example.com',
        password: 'password123',
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/templates');
    });
  });

  it('should display error message on login failure', async () => {
    const errorMessage = 'Invalid credentials';
    mockPost.mockRejectedValue({
      response: { data: { error: errorMessage } },
    });

    const { container } = await renderLogin();

    const emailInput = container.querySelector('#email')!;
    const passwordInput = container.querySelector('#password')!;
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should have link to register page', async () => {
    await renderLogin();

    const registerLink = screen.getByText(/don't have an account/i).closest('a');
    expect(registerLink).toHaveAttribute('href', '/register');
  });

  it('should disable submit button while loading', async () => {
    // Mock a slow API response
    mockPost.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: {} }), 1000))
    );

    const { container } = await renderLogin();

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    const emailInput = container.querySelector('#email')!;
    const passwordInput = container.querySelector('#password')!;

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });
  });

  describe('Forgot Password', () => {
    it('should have forgot password link', async () => {
      await renderLogin();

      expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
    });

    it('should open forgot password dialog when clicked', async () => {
      await renderLogin();

      const forgotPasswordLink = screen.getByText(/forgot password/i);
      fireEvent.click(forgotPasswordLink);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/reset password/i)).toBeInTheDocument();
        expect(screen.getByText(/enter your email address/i)).toBeInTheDocument();
      });
    });

    it('should close dialog when cancel is clicked', async () => {
      await renderLogin();

      const forgotPasswordLink = screen.getByText(/forgot password/i);
      fireEvent.click(forgotPasswordLink);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should submit forgot password request', async () => {
      mockForgotPassword.mockResolvedValue({
        message: 'If an account exists with this email, a password reset link has been sent.',
      });

      await renderLogin();

      const forgotPasswordLink = screen.getByText(/forgot password/i);
      fireEvent.click(forgotPasswordLink);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const emailInput = screen.getByRole('textbox', { name: /email address/i });
      const sendButton = screen.getByRole('button', { name: /send reset link/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockForgotPassword).toHaveBeenCalledWith('test@example.com');
        expect(screen.getByText(/if an account exists/i)).toBeInTheDocument();
      });
    });

    it('should show success message even on error (prevents enumeration)', async () => {
      mockForgotPassword.mockRejectedValue(new Error('Network error'));

      await renderLogin();

      const forgotPasswordLink = screen.getByText(/forgot password/i);
      fireEvent.click(forgotPasswordLink);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const emailInput = screen.getByRole('textbox', { name: /email address/i });
      const sendButton = screen.getByRole('button', { name: /send reset link/i });

      fireEvent.change(emailInput, { target: { value: 'nonexistent@example.com' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        // Should still show success message to prevent email enumeration
        expect(screen.getByText(/if an account exists/i)).toBeInTheDocument();
      });
    });

    it('should disable send button while loading', async () => {
      mockForgotPassword.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      await renderLogin();

      const forgotPasswordLink = screen.getByText(/forgot password/i);
      fireEvent.click(forgotPasswordLink);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const emailInput = screen.getByRole('textbox', { name: /email address/i });
      const sendButton = screen.getByRole('button', { name: /send reset link/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(sendButton).toBeDisabled();
        expect(screen.getByText(/sending/i)).toBeInTheDocument();
      });
    });

    it('should show close button after success', async () => {
      mockForgotPassword.mockResolvedValue({
        message: 'If an account exists with this email, a password reset link has been sent.',
      });

      await renderLogin();

      const forgotPasswordLink = screen.getByText(/forgot password/i);
      fireEvent.click(forgotPasswordLink);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const emailInput = screen.getByRole('textbox', { name: /email address/i });
      const sendButton = screen.getByRole('button', { name: /send reset link/i });

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        // After success, should show Close button instead of Cancel/Send
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /send reset link/i })).not.toBeInTheDocument();
      });
    });
  });
});
