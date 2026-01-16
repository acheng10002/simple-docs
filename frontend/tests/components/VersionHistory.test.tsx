import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VersionHistory from '../../src/components/VersionHistory';
import { templatesApi } from '../../src/api/client';
import type { TemplateVersion } from '../../src/types/api';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  templatesApi: {
    getVersions: vi.fn(),
    revertToVersion: vi.fn(),
  },
}));

const mockVersions: TemplateVersion[] = [
  {
    id: 'version-1',
    versionNumber: 3,
    displayName: 'My Template v3',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    createdAt: '2024-01-15T10:30:00.000Z',
    fieldsSnapshot: [
      { id: 'field-1', name: 'name' },
      { id: 'field-2', name: 'email' },
    ],
  },
  {
    id: 'version-2',
    versionNumber: 2,
    displayName: 'My Template v2',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    createdAt: '2024-01-10T14:00:00.000Z',
    fieldsSnapshot: [
      { id: 'field-1', name: 'name' },
    ],
  },
  {
    id: 'version-3',
    versionNumber: 1,
    displayName: 'My Template v1',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    createdAt: '2024-01-05T09:00:00.000Z',
    fieldsSnapshot: [],
  },
];

describe('VersionHistory', () => {
  const defaultProps = {
    templateId: 'template-1',
    onRevertSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading spinner while fetching versions', () => {
      vi.mocked(templatesApi.getVersions).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<VersionHistory {...defaultProps} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty message when no versions exist', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue([]);

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/no version history available/i)).toBeInTheDocument();
      });
    });
  });

  describe('Version List', () => {
    it('should display version history header', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Version History')).toBeInTheDocument();
        expect(screen.getByText(/versions are retained for 30 days/i)).toBeInTheDocument();
      });
    });

    it('should display all versions with correct information', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        // Check version numbers and field counts are displayed
        expect(screen.getByText(/2 field\(s\)/i)).toBeInTheDocument();
        expect(screen.getByText(/1 field\(s\)/i)).toBeInTheDocument();
        expect(screen.getByText(/0 field\(s\)/i)).toBeInTheDocument();
      });
    });

    it('should display revert button for each version', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        const revertButtons = screen.getAllByRole('button', { name: /revert/i });
        expect(revertButtons).toHaveLength(3);
      });
    });
  });

  describe('Revert Functionality', () => {
    it('should open confirmation dialog when revert is clicked', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /revert/i })[0]).toBeInTheDocument();
      });

      const revertButtons = screen.getAllByRole('button', { name: /revert/i });
      fireEvent.click(revertButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Confirm Revert')).toBeInTheDocument();
        expect(screen.getByText(/are you sure you want to revert to version 3/i)).toBeInTheDocument();
      });
    });

    it('should close confirmation dialog when cancel is clicked', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /revert/i })[0]).toBeInTheDocument();
      });

      const revertButtons = screen.getAllByRole('button', { name: /revert/i });
      fireEvent.click(revertButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Confirm Revert')).toBeInTheDocument();
      });

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText('Confirm Revert')).not.toBeInTheDocument();
      });
    });

    it('should call revertToVersion API when confirmed', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);
      vi.mocked(templatesApi.revertToVersion).mockResolvedValue({
        message: 'Reverted successfully',
        template: {} as any,
      });

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /revert/i })[0]).toBeInTheDocument();
      });

      const revertButtons = screen.getAllByRole('button', { name: /revert/i });
      fireEvent.click(revertButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Confirm Revert')).toBeInTheDocument();
      });

      // Find confirm button in dialog (not the list revert buttons)
      const dialogButtons = screen.getAllByRole('button', { name: /revert/i });
      const confirmButton = dialogButtons.find(btn => btn.closest('[role="dialog"]'));
      fireEvent.click(confirmButton!);

      await waitFor(() => {
        expect(templatesApi.revertToVersion).toHaveBeenCalledWith('template-1', 'version-1');
        expect(defaultProps.onRevertSuccess).toHaveBeenCalled();
      });
    });

    it('should show reverting state during API call', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);
      vi.mocked(templatesApi.revertToVersion).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /revert/i })[0]).toBeInTheDocument();
      });

      const revertButtons = screen.getAllByRole('button', { name: /revert/i });
      fireEvent.click(revertButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Confirm Revert')).toBeInTheDocument();
      });

      const dialogButtons = screen.getAllByRole('button', { name: /revert/i });
      const confirmButton = dialogButtons.find(btn => btn.closest('[role="dialog"]'));
      fireEvent.click(confirmButton!);

      await waitFor(() => {
        expect(screen.getByText(/reverting/i)).toBeInTheDocument();
      });
    });

    it('should reload versions after successful revert', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);
      vi.mocked(templatesApi.revertToVersion).mockResolvedValue({
        message: 'Reverted successfully',
        template: {} as any,
      });

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /revert/i })[0]).toBeInTheDocument();
      });

      // First call is initial load
      expect(templatesApi.getVersions).toHaveBeenCalledTimes(1);

      const revertButtons = screen.getAllByRole('button', { name: /revert/i });
      fireEvent.click(revertButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Confirm Revert')).toBeInTheDocument();
      });

      const dialogButtons = screen.getAllByRole('button', { name: /revert/i });
      const confirmButton = dialogButtons.find(btn => btn.closest('[role="dialog"]'));
      fireEvent.click(confirmButton!);

      await waitFor(() => {
        // Second call after revert
        expect(templatesApi.getVersions).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when loading fails', async () => {
      vi.mocked(templatesApi.getVersions).mockRejectedValue({
        response: { data: { error: 'Failed to load version history' } },
      });

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load version history')).toBeInTheDocument();
      });
    });

    it('should display error message when revert fails', async () => {
      vi.mocked(templatesApi.getVersions).mockResolvedValue(mockVersions);
      vi.mocked(templatesApi.revertToVersion).mockRejectedValue({
        response: { data: { error: 'Failed to revert to version' } },
      });

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /revert/i })[0]).toBeInTheDocument();
      });

      const revertButtons = screen.getAllByRole('button', { name: /revert/i });
      fireEvent.click(revertButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Confirm Revert')).toBeInTheDocument();
      });

      const dialogButtons = screen.getAllByRole('button', { name: /revert/i });
      const confirmButton = dialogButtons.find(btn => btn.closest('[role="dialog"]'));
      fireEvent.click(confirmButton!);

      await waitFor(() => {
        expect(screen.getByText('Failed to revert to version')).toBeInTheDocument();
      });
    });

    it('should allow closing error alert', async () => {
      vi.mocked(templatesApi.getVersions).mockRejectedValue({
        response: { data: { error: 'Failed to load version history' } },
      });

      render(<VersionHistory {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load version history')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Failed to load version history')).not.toBeInTheDocument();
      });
    });
  });
});
