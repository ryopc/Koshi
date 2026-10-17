import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { t, getLang, setLang } from '../i18n.js';

export default function Header({ lang, onLangChange }) {
  const { user, isAuthenticated, logout } = useAuth();
  const location = useLocation();
  const currentLang = lang || getLang();

  const navItems = [
    { path: '/', key: 'navHome', exact: true },
    { path: '/dm', key: 'navDMs', prefix: true },
    { path: '/search', key: 'navPosts', exact: true },
    { path: '/nostr', key: 'navNostr', exact: true },
  ];

  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="header-left">
          <Link to="/" className="header-logo">
            <span className="logo-icon">🌊</span>
            <span className="logo-text">{t('appName', currentLang)}</span>
          </Link>
          <span className="mode-badge">web</span>
        </div>
        <div className="header-center desktop-only">
          <nav className="header-nav">
            {navItems.map((item) => {
              const active = item.exact
                ? location.pathname === item.path
                : location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`nav-item ${active ? 'active' : ''}`}
                >
                  {t(item.key, currentLang)}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="header-right">
          <div className="lang-switch">
            <button
              className={`lang-btn ${currentLang === 'en' ? 'active' : ''}`}
              onClick={() => {
                setLang('en');
                onLangChange && onLangChange('en');
              }}
            >
              EN
            </button>
            <button
              className={`lang-btn ${currentLang === 'ja' ? 'active' : ''}`}
              onClick={() => {
                setLang('ja');
                onLangChange && onLangChange('ja');
              }}
            >
              JA
            </button>
          </div>
          {isAuthenticated && user ? (
            <>
              <span className="header-username">@{user.username}</span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>
                {t('btnLogout', currentLang)}
              </button>
            </>
          ) : (
            <Link to="/login" className="btn btn-ghost btn-sm">
              {t('btnLogin', currentLang)}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
