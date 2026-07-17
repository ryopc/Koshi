import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setSearched(true);
    try {
      const data = await api(`/users/search/${encodeURIComponent(q)}`);
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-search">
      <div className="feed-header">
        <div className="feed-title">🔍 User Search</div>
      </div>

      <form className="search-form" onSubmit={handleSearch}>
        <div className="search-input-wrapper">
          <span className="search-prompt">$</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search users..."
            className="search-input"
            autoFocus
          />
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!query.trim() || loading}>
          {loading ? '...' : 'Search'}
        </button>
      </form>

      {searched && results.length === 0 && !loading && (
        <div className="empty-state">
          <span className="empty-icon">🔍</span>
          <span className="empty-text">No users found</span>
        </div>
      )}

      <div className="search-results">
        {results.map((user) => (
          <div
            key={user.id || user.username}
            className="search-result-item"
            onClick={() => navigate(`/profile/${user.username}`)}
          >
            <div className="search-result-avatar">
              {(user.username?.[0] || '?').toUpperCase()}
            </div>
            <div className="search-result-info">
              <div className="search-result-name">@{user.username}</div>
              {user.displayName && (
                <div className="search-result-display">{user.displayName}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="cli-promo">
        <div className="cli-promo-title">💡 Use the CLI for advanced search</div>
        <div className="cli-promo-code">$ kb search username</div>
        <div className="cli-promo-hint">Follow users directly from the terminal</div>
      </div>
    </div>
  );
}
