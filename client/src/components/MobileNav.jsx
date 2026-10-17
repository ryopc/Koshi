import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { t, getLang } from '../i18n.js';

const navItems = [
  {
    to: '/',
    key: 'navHome',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    to: '/dm',
    key: 'navDMs',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    to: '/search',
    key: 'navPosts',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    to: '/profile',
    key: 'navSettings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export default function MobileNav({ dmUnreadCount = 0, lang }) {
  const location = useLocation();
  const currentLang = lang || getLang();

  const isActive = (to) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <nav className="mobile-nav">
      {navItems.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={`mobile-nav-item ${isActive(item.to) ? 'active' : ''}`}
        >
          <div style={{ position: 'relative' }}>
            {item.icon}
            {item.key === 'navDMs' && dmUnreadCount > 0 && (
              <span className="dm-badge">{dmUnreadCount > 99 ? '99+' : dmUnreadCount}</span>
            )}
          </div>
          <span>{t(item.key, currentLang)}</span>
        </Link>
      ))}
    </nav>
  );
}
