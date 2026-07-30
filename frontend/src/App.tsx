import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { SupabaseAuthProvider } from './context/SupabaseAuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import Templates from './pages/Templates';
import Merge from './pages/Merge';
import EditTemplate from './pages/EditTemplate';
import Outputs from './pages/Outputs';
import Settings from './pages/Settings';

const theme = createTheme({
  palette: {
    primary: {
      main: '#2e72c2',
      light: '#a2b4d7',
      dark: '#1a4a8a',
    },
    secondary: {
      main: '#cbb2b9',
    },
    background: {
      default: '#f5f7fa',
      paper: '#ffffff',
    },
    text: {
      primary: '#1a2138',
      secondary: '#566d92',
    },
  },
  typography: {
    fontFamily: '"DM Sans", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 650,
      letterSpacing: '-0.02em',
    },
    h5: {
      fontWeight: 550,
      letterSpacing: '-0.01em',
    },
    body2: {
      lineHeight: 1.6,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          padding: '10px 24px',
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 2px 8px rgba(57, 83, 132, 0.25)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
        },
      },
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SupabaseAuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Protected routes */}
            <Route
              path="/templates"
              element={
                <ProtectedRoute>
                  <Templates />
                </ProtectedRoute>
              }
            />
            <Route
              path="/templates/:templateId/merge"
              element={
                <ProtectedRoute>
                  <Merge />
                </ProtectedRoute>
              }
            />
            <Route
              path="/templates/:templateId/edit"
              element={
                <ProtectedRoute>
                  <EditTemplate />
                </ProtectedRoute>
              }
            />
            <Route
              path="/outputs"
              element={
                <ProtectedRoute>
                  <Outputs />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/templates" replace />} />
            <Route path="*" element={<Navigate to="/templates" replace />} />
          </Routes>
        </BrowserRouter>
      </SupabaseAuthProvider>
    </ThemeProvider>
  );
}

export default App;
