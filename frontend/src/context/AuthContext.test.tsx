import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as apiClient from '../api/client';

// Mock the API client
vi.mock('../api/client', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('AuthContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should provide initial auth state as null', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should load user from localStorage on mount', () => {
    const mockUser = { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' };
    localStorageMock.setItem('user', JSON.stringify(mockUser));
    localStorageMock.setItem('token', 'test-token');

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    expect(result.current.user).toEqual(mockUser);
  });

  it('should login successfully', async () => {
    const mockResponse = {
      token: 'test-token',
      user: { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' },
    };

    vi.mocked(apiClient.authApi.login).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await act(async () => {
      await result.current.login('test@example.com', 'password');
    });

    expect(result.current.user).toEqual(mockResponse.user);
    expect(localStorageMock.getItem('token')).toBe('test-token');
    expect(localStorageMock.getItem('user')).toBe(JSON.stringify(mockResponse.user));
  });

  it('should handle login error', async () => {
    vi.mocked(apiClient.authApi.login).mockRejectedValue(new Error('Invalid credentials'));

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await expect(
      act(async () => {
        await result.current.login('test@example.com', 'wrong-password');
      })
    ).rejects.toThrow('Invalid credentials');

    expect(result.current.user).toBeNull();
    expect(localStorageMock.getItem('token')).toBeNull();
  });

  it('should register successfully', async () => {
    const mockResponse = {
      token: 'test-token',
      user: { id: '1', email: 'new@example.com', firstName: 'New', lastName: 'User' },
    };

    vi.mocked(apiClient.authApi.register).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await act(async () => {
      await result.current.register('new@example.com', 'password', 'New', 'User');
    });

    expect(result.current.user).toEqual(mockResponse.user);
    expect(localStorageMock.getItem('token')).toBe('test-token');
  });

  it('should logout successfully', () => {
    const mockUser = { id: '1', email: 'test@example.com', firstName: 'Test', lastName: 'User' };
    localStorageMock.setItem('user', JSON.stringify(mockUser));
    localStorageMock.setItem('token', 'test-token');

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    act(() => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(localStorageMock.getItem('token')).toBeNull();
    expect(localStorageMock.getItem('user')).toBeNull();
  });
});
