import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Merge from '../../src/pages/Merge';
import { SupabaseAuthProvider } from '../../src/context/SupabaseAuthContext';

const { mockGetById, mockMergeSingle, mockTestMerge } = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockMergeSingle: vi.fn(),
  mockTestMerge: vi.fn(),
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
    post: vi.fn(),
  },
  templatesApi: {
    getById: mockGetById,
  },
  mergeApi: {
    mergeSingle: mockMergeSingle,
    testMerge: mockTestMerge,
  },
}));

vi.mock('../../src/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      setSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const mockTemplate = {
  id: 'template-1',
  displayName: 'Invoice Template',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  defaultOutputType: 'pdf',
  fields: [
    { id: 'f1', name: 'customerName' },
    { id: 'f2', name: 'amount' },
  ],
  isActive: true,
};

const renderMerge = () => {
  return render(
    <SupabaseAuthProvider>
      <MemoryRouter initialEntries={['/templates/template-1/merge']}>
        <Routes>
          <Route path="/templates/:templateId/merge" element={<Merge />} />
          <Route path="/outputs" element={<div>Outputs Page</div>} />
          <Route path="/templates" element={<div>Templates Page</div>} />
        </Routes>
      </MemoryRouter>
    </SupabaseAuthProvider>
  );
};

describe('Merge Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  it('should show loading state initially', () => {
    mockGetById.mockReturnValue(new Promise(() => {})); // never resolves
    renderMerge();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should render template fields after loading', async () => {
    mockGetById.mockResolvedValue(mockTemplate);
    renderMerge();

    await waitFor(() => {
      expect(screen.getByText('Fill Template Fields')).toBeInTheDocument();
      expect(screen.getByLabelText('customerName *')).toBeInTheDocument();
      expect(screen.getByLabelText('amount *')).toBeInTheDocument();
    });
  });

  it('should show error when template load fails', async () => {
    mockGetById.mockRejectedValue({
      response: { data: { error: 'Template not found' } },
    });
    renderMerge();

    await waitFor(() => {
      expect(screen.getByText('Template not found')).toBeInTheDocument();
    });
  });

  it('should show template name in header', async () => {
    mockGetById.mockResolvedValue(mockTemplate);
    renderMerge();

    await waitFor(() => {
      expect(screen.getByText('Merge Template: Invoice Template')).toBeInTheDocument();
    });
  });

  it('should show error when submitting with empty fields', async () => {
    mockGetById.mockResolvedValue(mockTemplate);
    renderMerge();

    await waitFor(() => {
      expect(screen.getByText('Fill Template Fields')).toBeInTheDocument();
    });

    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/please fill in all fields/i)).toBeInTheDocument();
    });
  });

  it('should call mergeSingle on successful submit', async () => {
    mockGetById.mockResolvedValue(mockTemplate);
    mockMergeSingle.mockResolvedValue({ jobId: 1, filePath: 's3://output.pdf' });
    renderMerge();

    await waitFor(() => {
      expect(screen.getByLabelText('customerName *')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('customerName *'), { target: { value: 'John' } });
    fireEvent.change(screen.getByLabelText('amount *'), { target: { value: '100' } });

    const mergeButton = screen.getByRole('button', { name: /^merge$/i });
    fireEvent.click(mergeButton);

    await waitFor(() => {
      expect(mockMergeSingle).toHaveBeenCalledWith('template-1', {
        data: { customerName: 'John', amount: '100' },
        outputType: 'pdf',
      });
      expect(screen.getByText(/document merged successfully/i)).toBeInTheDocument();
    });
  });

  it('should show error on merge failure', async () => {
    mockGetById.mockResolvedValue(mockTemplate);
    mockMergeSingle.mockRejectedValue({
      response: { data: { error: 'Merge failed' } },
    });
    renderMerge();

    await waitFor(() => {
      expect(screen.getByLabelText('customerName *')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('customerName *'), { target: { value: 'John' } });
    fireEvent.change(screen.getByLabelText('amount *'), { target: { value: '100' } });

    const mergeButton = screen.getByRole('button', { name: /^merge$/i });
    fireEvent.click(mergeButton);

    await waitFor(() => {
      expect(screen.getByText('Merge failed')).toBeInTheDocument();
    });
  });

  it('should show error when test merge has empty fields', async () => {
    mockGetById.mockResolvedValue(mockTemplate);
    renderMerge();

    await waitFor(() => {
      expect(screen.getByText('Fill Template Fields')).toBeInTheDocument();
    });

    const testButton = screen.getByRole('button', { name: /test merge/i });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByText(/please fill in all fields/i)).toBeInTheDocument();
    });
  });

  it('should disable buttons while merging', async () => {
    mockGetById.mockResolvedValue(mockTemplate);
    mockMergeSingle.mockReturnValue(new Promise(() => {})); // never resolves
    renderMerge();

    await waitFor(() => {
      expect(screen.getByLabelText('customerName *')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('customerName *'), { target: { value: 'John' } });
    fireEvent.change(screen.getByLabelText('amount *'), { target: { value: '100' } });

    const mergeButton = screen.getByRole('button', { name: /^merge$/i });
    fireEvent.click(mergeButton);

    await waitFor(() => {
      expect(screen.getByText('Merging...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /test merge/i })).toBeDisabled();
    });
  });
});
