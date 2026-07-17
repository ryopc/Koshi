import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';

export default function Header() {
  const { user, isAuthenticated, logout } = useAuth();
  const location = useLocation();

  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="header-left">
          <Link to="/" className="header-logo">
            <span className="logo-icon">🌊</span>
            <span className="logo-text">koshi</span>
          </Link>
          <span className="mode-badge">web</span>
        </div>
        <div className="header-center desktop-only">
          <nav className="header-nav">
            <Link
              to="/"
              className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}
            >
              Feed
            </Link>
            <Link
              to="/dm"
              className={`nav-item ${location.pathname.startsWith('/dm') ? 'active' : ''}`}
            >
              Messages
            </Link>
            <Link
              to="/search"
              className={`nav-item ${location.pathname === '/search' ? 'active' : ''}`}
            >
              Search
            </Link>
            <Link
              to="/nostr"
              className={`nav-item ${location.pathname === '/nostr' ? 'active' : ''}`}
            >
              Nostr
            </Link>
          </nav>
        </div>
        <div className="header-right">
          {isAuthenticated && user ? (
            <>
              <span className="header-username">@{user.username}</span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>
                logout
              </button>
            </>
          ) : (
            <Link to="/login" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
