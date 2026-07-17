import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { api } from '../utils/api.js';
import { signMessage } from '../utils/crypto.js';
import { getSK } from '../utils/storage.js';

const timeShort = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${h}:${m}`;
  const mon = d.getMonth() + 1;
  const day = d.getDate();
  return `${mon}/${day} ${h}:${m}`;
};

export default function DMChatPage({ onUnreadChange }) {
  const { username } = useParams();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  const scrollToBottom = (smooth = true) => {
    setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
      }
    }, 50);
  };

  const handleWSMessage = useCallback((msg) => {
    if (msg.type === 'dm_received') {
      const dm = msg.payload;
      const senderUsername = dm.from?.username;
      if (senderUsername === username) {
        setMessages((prev) => [...prev, { ...dm, _direction: 'received' }]);
        scrollToBottom();
        // Mark as read
        api(`/dms/${dm.id}/read`, { method: 'PUT' }).catch(() => {});
      } else {
        // Increment unread count
        window.__koshi_incrementUnread?.();
        toast(`💬 Message from ${senderUsername}`, 'info');
      }
    }
  }, [username, toast]);

  const { send } = useWebSocket(handleWSMessage);

  useEffect(() => {
    if (!username || !isAuthenticated) return;
    loadChat();

    async function loadChat() {
      setLoading(true);
      setError('');
      try {
        const r = await api(`/users/${username}`);
        setRecipient(r);

        const dms = await api('/dms?limit=100');
        const conversation = dms
          .filter((dm) =>
            (dm.from.username === username && dm.to.username === user.username) ||
            (dm.from.username === user.username && dm.to.username === username)
          )
          .reverse();

        const msgs = conversation.map((dm) => ({
          ...dm,
          _direction: dm.from.username === user.username ? 'sent' : 'received',
        }));
        setMessages(msgs);

        // Mark unread received messages as read
        for (const dm of conversation) {
          if (!dm.isRead && dm.to.username === user.username) {
            api(`/dms/${dm.id}/read`, { method: 'PUT' }).catch(() => {});
          }
        }

        scrollToBottom(false);
        onUnreadChange?.();
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }, [username, isAuthenticated, user, onUnreadChange]);

  const handleSend = async () => {
    if (!input.trim() || !recipient || sending) return;
    setSending(true);
    try {
      const sk = getSK(user.username);
      if (!sk) throw new Error('Secret key not found');
      const sig = await signMessage(input.trim(), sk);

      if (send) {
        send('dm:send', { recipientId: recipient.id, content: input.trim(), signature: sig });
      } else {
        await api(`/dms/${recipient.id}`, {
          method: 'POST',
          body: { content: input.trim(), signature: sig },
        });
      }

      const optimistic = {
        id: 'pending-' + Date.now(),
        content: input.trim(),
        signature: sig,
        createdAt: new Date().toISOString(),
        from: { username: user.username },
        _direction: 'sent',
      };
      setMessages((prev) => [...prev, optimistic]);
      setInput('');
      scrollToBottom();
    } catch (e) {
      toast(`Send failed: ${e.message}`, 'error');
    } finally {
      setSending(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: '1rem' }}>Login required to chat</p>
          <Link to="/login" className="btn btn-primary">Login</Link>
        </div>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="error-page">
        <div className="error-card">
          <p>{error}</p>
          <Link to="/dm" className="btn">Back to DM list</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dm-chat">
      <div className="dm-chat-header">
        <Link to="/dm" className="dm-chat-back">←</Link>
        <span className="dm-chat-user">@{username}</span>
      </div>

      <div className="dm-messages" ref={messagesContainerRef}>
        {loading ? (
          <div className="skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div>
              <span className="empty-icon">💬</span>
              <span className="empty-text">Send a message to @{username}</span>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id || msg._id} className={`dm-msg ${msg._direction}`}>
              <div>{msg.content}</div>
              <div className="dm-msg-time">{timeShort(msg.createdAt || msg.timestamp)}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="dm-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (input.trim()) handleSend();
            }
          }}
          placeholder="Type a message..."
          rows={1}
          maxLength={5000}
        />
        <button
          className="dm-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
