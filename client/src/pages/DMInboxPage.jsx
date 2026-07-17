import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { api } from '../utils/api.js';
import { FeedSkeleton } from '../components/Skeleton.jsx';

const ago = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function DMInboxPage({ onUnreadChange }) {
  const { user, isAuthenticated } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadInbox();
    async function loadInbox() {
      try {
        const dms = await api('/dms?limit=100');
        const chatMap = new Map();
        for (const dm of dms) {
          const partner = dm.from.username === user.username ? dm.to : dm.from;
          if (!chatMap.has(partner.username)) {
            chatMap.set(partner.username, {
              partner,
              lastMessage: dm,
              unread: !dm.isRead && dm.to.username === user.username,
            });
          }
        }
        setConversations([...chatMap.values()]);
        onUnreadChange?.();
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }, [user, onUnreadChange]);

  if (!isAuthenticated) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: '1rem' }}>Login required to view messages</p>
          <Link to="/login" className="btn btn-primary">Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dm-inbox">
      <div className="dm-inbox-header">
        <div className="dm-inbox-title">💬 Direct Messages</div>
      </div>

      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <div className="error">{error}</div>
      ) : conversations.length === 0 ? (
        <>
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <span className="empty-text">No messages yet</span>
          </div>
          <div className="cli-promo" style={{ marginTop: '1rem' }}>
            <div className="cli-promo-title">Start a DM from a user's profile</div>
          </div>
        </>
      ) : (
        <div className="conversation-list">
          {conversations.map((conv) => (
            <Link
              key={conv.partner.username}
              to={`/dm/${conv.partner.username}`}
              className="dm-thread"
            >
              <div className="dm-thread-avatar">
                {(conv.partner.username[0] || '?').toUpperCase()}
              </div>
              <div className="dm-thread-info">
                <div className="dm-thread-name">@{conv.partner.username}</div>
                <div className="dm-thread-preview">
                  {conv.lastMessage.content.slice(0, 60)}
                </div>
              </div>
              <div className="dm-thread-meta">
                <span className="dm-thread-time">
                  {ago(conv.lastMessage.createdAt)}
                </span>
                {conv.unread && <span className="dm-thread-unread" />}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
