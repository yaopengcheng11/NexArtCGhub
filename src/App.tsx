import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import Admin from './pages/Admin';
import Login from './pages/Login';
import { AuthProvider } from './context/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div
          className="relative min-h-screen font-sans flex flex-col overflow-x-hidden"
          style={{ background: 'var(--color-base)', color: 'var(--color-fg)' }}
        >
          {/* ===== Ethereal decoration: floating blur orbs ===== */}
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

          {/* ===== Noise grain (global texture) ===== */}
          <div className="grain-layer" aria-hidden />

          {/* ===== Content ===== */}
          <div className="relative z-10 flex min-h-screen flex-col">
            <Navbar />
            <main className="flex-1 w-full max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 py-8">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/login" element={<Login />} />
              </Routes>
            </main>
            <Footer />
          </div>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
