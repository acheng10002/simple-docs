/* Mock @supabase/supabase-js package for testing
- prevents real Supabase client creation which requires env vars
- returns mock clients that can be configured in tests */

const mockSupabaseClient = {
  auth: {
    getUser: jest.fn(),
    signInWithPassword: jest.fn(),
    admin: {
      createUser: jest.fn(),
      signOut: jest.fn(),
    },
  },
};

const createClient = jest.fn(() => mockSupabaseClient);

module.exports = {
  createClient,
};
