import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Register from '../../src/pages/Register';
import { SupabaseAuthProvider } from '../../src/context/SupabaseAuthContext';

const { mockRegister, mockGetSession } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockGetSession: vi.fn(),
}));

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../src/api/client', () => ({
  getErrorMessage: (err: any, fallback: string) => {
    const d = err?.response?.data?.error;
    return typeof d === 'string' ? d : d?.message || fallback;
  },
  default: {
    post: mockRegister,
  },
  authApi: {
    register: vi.fn(),
  },
}));

vi.mock('../../src/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession.mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      setSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const renderRegister = async () => {
  render(
    <SupabaseAuthProvider>
      <BrowserRouter>
        <Register />
      </BrowserRouter>
    </SupabaseAuthProvider>
  );

  await waitFor(() => {
    expect(screen.getByText('MergeMyDocs')).toBeInTheDocument();
  });
};

describe('Register Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  it('should render registration form', async () => {
    await renderRegister();

    expect(screen.getByText('Create your account')).toBeInTheDocument();
    expect(screen.getByLabelText('First Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address *')).toBeInTheDocument();
    expect(screen.getByLabelText('Password *')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  it('should have link to login page', async () => {
    await renderRegister();

    const loginLink = screen.getByText(/already have an account/i).closest('a');
    expect(loginLink).toHaveAttribute('href', '/login');
  });

  it('should show error when passwords do not match', async () => {
    await renderRegister();

    fireEvent.change(screen.getByLabelText('Email Address *'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password *'), { target: { value: 'Different1!' } });

    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  it('should show error when password does not meet requirements', async () => {
    await renderRegister();

    fireEvent.change(screen.getByLabelText('Email Address *'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'weak' } });
    fireEvent.change(screen.getByLabelText('Confirm Password *'), { target: { value: 'weak' } });

    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Password does not meet all requirements')).toBeInTheDocument();
    });
  });

  it('should show password criteria', async () => {
    await renderRegister();

    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('At least one uppercase letter')).toBeInTheDocument();
    expect(screen.getByText('At least one lowercase letter')).toBeInTheDocument();
    expect(screen.getByText('At least one number')).toBeInTheDocument();
    expect(screen.getByText('At least one special character')).toBeInTheDocument();
  });

  it('should call register and navigate on successful submit', async () => {
    mockRegister.mockResolvedValue({
      data: {
        user: { id: '1', email: 'test@test.com' },
        session: { access_token: 'token', refresh_token: 'refresh' },
      },
    });

    await renderRegister();

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'John' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Email Address *'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password *'), { target: { value: 'Password1!' } });

    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { registered: true } });
    });
  });

  it('should show error on registration failure', async () => {
    mockRegister.mockRejectedValue({
      response: { data: { message: 'Email already in use' } },
    });

    await renderRegister();

    fireEvent.change(screen.getByLabelText('Email Address *'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password *'), { target: { value: 'Password1!' } });

    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Email already in use')).toBeInTheDocument();
    });
  });

  it('should disable submit button while loading', async () => {
    mockRegister.mockReturnValue(new Promise(() => {})); // never resolves

    await renderRegister();

    fireEvent.change(screen.getByLabelText('Email Address *'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password *'), { target: { value: 'Password1!' } });

    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Creating account...')).toBeInTheDocument();
    });
  });
});
