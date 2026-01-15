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

// Create Material-UI theme with Google-esque design
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2', // Google Blue
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', // Google-style buttons don't use uppercase
          borderRadius: 4,
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
