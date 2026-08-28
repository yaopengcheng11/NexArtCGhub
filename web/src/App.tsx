import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import Admin from './pages/Admin';
import Login from './pages/Login';
import Register from './pages/Register';
import ResourceDetail from './pages/ResourceDetail';
import ToolHipPathDoctor from './pages/ToolHipPathDoctor';
import ToolHipFormatBridge from './pages/ToolHipFormatBridge';
import ToolGsplatsTrainer from './pages/ToolGsplatsTrainer';
import Pricing from './pages/Pricing';
import { AuthProvider } from './context/AuthContext';
import { I18nProvider } from './i18n/I18nContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { NotFound } from './components/NotFound';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <div
              className="relative min-h-screen font-sans flex flex-col overflow-x-hidden"
              style={{ background: 'var(--color-base)', color: 'var(--color-fg)' }}
            >
              <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
                <div
                  className="absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full blur-3xl"
                  style={{ background: 'var(--orb-warm, rgba(212,184,150,0.45))' }}
                />
                <div
                  className="absolute top-1/4 -right-40 h-[520px] w-[520px] rounded-full blur-3xl"
                  style={{ background: 'var(--orb-cool, rgba(176,196,212,0.35))' }}
                />
                <div
                  className="absolute -bottom-40 left-1/3 h-[560px] w-[560px] rounded-full blur-3xl"
                  style={{ background: 'var(--orb-veil, rgba(220,204,228,0.4))' }}
                />
              </div>

              <div className="grain-layer" aria-hidden />

              <div className="relative z-10 flex min-h-screen flex-col">
                <Navbar />
                  <main className="flex-1 w-full max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 py-8">
                    {/* Route-level error boundary: a page render error
                        unmounts only this subtree, leaving Navbar, Footer
                        and the toast queue alive. */}
                    <ErrorBoundary>
                      <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/resource/:id" element={<ResourceDetail />} />
                        <Route path="/tools/hip-path-doctor" element={<ToolHipPathDoctor />} />
                        <Route path="/tools/hip-format-bridge" element={<ToolHipFormatBridge />} />
                        <Route path="/tools/gsplats-trainer" element={<ToolGsplatsTrainer />} />
                        <Route path="/pricing" element={<Pricing />} />
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                        <Route
                          path="/admin"
                          element={
                            <ProtectedRoute requireRole="admin">
                              <Admin />
                            </ProtectedRoute>
                          }
                        />
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </ErrorBoundary>
                  </main>
                  <Footer />
                </div>
              </div>
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
  );
}
