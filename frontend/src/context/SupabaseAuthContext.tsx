import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { User, LoginRequest, RegisterRequest } from '../types/api';
import { supabase } from '../config/supabase';
import type { Session } from '@supabase/supabase-js';
import apiClient from '../api/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const SupabaseAuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(SupabaseAuthContext);
  if (!context) {
    throw new Error('useAuth must be used within SupabaseAuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const SupabaseAuthProvider = ({ children }: AuthProviderProps) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize session from Supabase
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);

      if (session?.user) {
        // Load database user info from stored data
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          setUser(JSON.parse(storedUser));
        }
      }
      setIsLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);

      if (!session) {
        setUser(null);
        localStorage.removeItem('user');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (data: LoginRequest) => {
    // Call backend login which handles Supabase auth
    const response = await apiClient.post('/api/auth/login', data);

    const { session: newSession, user: dbUser } = response.data;

    // Set session in Supabase client
    if (newSession) {
      await supabase.auth.setSession({
        access_token: newSession.access_token,
        refresh_token: newSession.refresh_token,
      });
    }

    setUser(dbUser);
    localStorage.setItem('user', JSON.stringify(dbUser));
  };

  const register = async (data: RegisterRequest) => {
    // Call backend register which creates user in Supabase + database
    const response = await apiClient.post('/api/auth/register', data);

    const { session: newSession, user: dbUser } = response.data;

    // Set session in Supabase client
    if (newSession) {
      await supabase.auth.setSession({
        access_token: newSession.access_token,
        refresh_token: newSession.refresh_token,
      });
    }

    setUser(dbUser);
    localStorage.setItem('user', JSON.stringify(dbUser));
  };

  const logout = async () => {
    // Call backend logout
    try {
      await apiClient.post('/api/auth/logout');
    } catch (error) {
      // Continue with logout even if backend call fails
      console.error('Logout error:', error);
    }

    // Sign out from Supabase
    await supabase.auth.signOut();

    setSession(null);
    setUser(null);
    localStorage.removeItem('user');
  };

  const value: AuthContextType = {
    user,
    session,
    login,
    register,
    logout,
    isAuthenticated: !!session,
    isLoading,
  };

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
};
