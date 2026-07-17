import React, { useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/AuthContext.jsx';
import { useToast } from './components/Toast.jsx';
import { api } from './utils/api.js';
import Header from './components/Header.jsx';
import MobileNav from './components/MobileNav.jsx';
import FeedPage from './pages/FeedPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import DMInboxPage from './pages/DMInboxPage.jsx';
import DMChatPage from './pages/DMChatPage.jsx';
import NostrPage from './pages/NostrPage.jsx';
import SearchPage from './pages/SearchPage.jsx';

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { loading, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPwaPrompt, setShowPwaPrompt] = useState(false);

  // Load unread DM count
  const refreshUnreadCount = useCallback(async () => {
    if (!isAuthenticated) {
      setDmUnreadCount(0);
      return;
    }
    try {
      const { count } = await api('/dms/unread/count');
      setDmUnreadCount(count || 0);
    } catch {
      // Silently fail
    }
  }, [isAuthenticated]);

  // Increment unread count when new DM arrives (called by DMChatPage via event)
  const incrementUnread = useCallback(() => {
    setDmUnreadCount((c) => c + 1);
  }, []);

  // Expose increment function globally for WebSocket handlers
  useEffect(() => {
    window.__koshi_incrementUnread = incrementUnread;
    window.__koshi_refreshUnreadCount = refreshUnreadCount;
    return () => {
      delete window.__koshi_incrementUnread;
      delete window.__koshi_refreshUnreadCount;
    };
  }, [incrementUnread, refreshUnreadCount]);

  // Refresh unread count when auth state changes
  useEffect(() => {
    refreshUnreadCount();
  }, [isAuthenticated, refreshUnreadCount]);

  // Hide loading overlay after mount
  useEffect(() => {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';
  }, []);

  // PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!localStorage.getItem('k:pwa-dismiss')) {
        setShowPwaPrompt(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Service worker registration
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }, []);

  const handlePwaInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('App installed!', 'success');
    setDeferredPrompt(null);
    setShowPwaPrompt(false);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-cursor" />
        <div className="loading-text">
          koshi board <span className="blink">_</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<FeedPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/nostr" element={<NostrPage />} />
          <Route
            path="/dm"
            element={
              <ProtectedRoute>
                <DMInboxPage onUnreadChange={refreshUnreadCount} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dm/:username"
            element={
              <ProtectedRoute>
                <DMChatPage onUnreadChange={refreshUnreadCount} />
              </ProtectedRoute>
            }
          />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:username" element={<ProfilePage />} />
          <Route path="*" element={<FeedPage />} />
        </Routes>
      </main>

      {/* Mobile Navigation with DM badge */}
      <MobileNav dmUnreadCount={dmUnreadCount} />

      {/* PWA Install Prompt */}
      {showPwaPrompt && (
        <div className="pwa-prompt">
          <div className="pwa-card">
            <span className="pwa-icon">🌊</span>
            <div className="pwa-text">
              <strong>Install koshi</strong>
              <small>App-like experience</small>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handlePwaInstall}>Install</button>
            <button
              className="btn btn-icon pwa-dismiss"
              onClick={() => {
                setShowPwaPrompt(false);
                localStorage.setItem('k:pwa-dismiss', '1');
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
