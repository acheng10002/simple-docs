/* Mock supabase-auth config for testing
- provides mock Supabase clients with jest functions */

const supabaseAdmin = {
  auth: {
    getUser: jest.fn(),
    admin: {
      createUser: jest.fn(),
      signOut: jest.fn(),
      updateUserById: jest.fn(),
    },
  },
};

const supabaseClient = {
  auth: {
    signInWithPassword: jest.fn(),
    resetPasswordForEmail: jest.fn(),
  },
};

module.exports = { supabaseAdmin, supabaseClient };
