import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../store/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { api } from '../utils/api.js';
import { signMessage } from '../utils/crypto.js';
import { getSK } from '../utils/storage.js';
import PostCard from '../components/PostCard.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';

export default function FeedPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleWSMessage = useCallback((msg) => {
    if (msg.type === 'post_created' && msg.payload?.author?.username !== user?.username) {
      setPosts((prev) => [msg.payload, ...prev]);
      toast(`${msg.payload.author?.username}: ${msg.payload.content.slice(0, 30)}...`, 'info');
    }
  }, [user, toast]);

  const { send } = useWebSocket(handleWSMessage);

  useEffect(() => {
    loadFeed();
    async function loadFeed() {
      try {
        const data = await api('/posts/feed?limit=50');
        setPosts(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }, []);

  const handleSubmit = async () => {
    if (!content.trim() || !isAuthenticated || submitting) return;
    setSubmitting(true);
    setError('');

    try {
      const sk = getSK(user.username);
      if (!sk) throw new Error('Secret key not found');
      const sig = await signMessage(content.trim(), sk);

      if (send) {
        send('post:create', { content: content.trim(), signature: sig });
        const optimistic = {
          id: 'pending-' + Date.now(),
          content: content.trim(),
          signature: sig,
          createdAt: new Date().toISOString(),
          author: { username: user.username },
        };
        setPosts((prev) => [optimistic, ...prev]);
      } else {
        await api('/posts', { method: 'POST', body: { content: content.trim(), signature: sig } });
        const data = await api('/posts/feed?limit=50');
        setPosts(data);
      }

      setContent('');
      toast('Posted!', 'success');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-feed">
      <div className="feed-header">
        <div className="feed-title">$ cat /var/log/feed</div>
        <span className="feed-count">{posts.length} posts</span>
      </div>

      {isAuthenticated ? (
        <div className="post-form">
          <div className="post-form-header">
            <span className="prompt">$</span>
            <span>koshi post</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's happening?"
            maxLength={2000}
            rows={3}
          />
          <div className="post-form-footer">
            <span className={`char-count ${content.length > 1900 ? (content.length >= 2000 ? 'limit' : 'warn') : ''}`}>
              {content.length} / 2000
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSubmit}
              disabled={!content.trim() || submitting}
            >
              {submitting ? '...' : 'Post'}
            </button>
          </div>
          {error && <div className="error" style={{ marginTop: '0.5rem' }}>{error}</div>}
        </div>
      ) : (
        <div className="cli-promo">
          <div className="cli-promo-title">Login required to post</div>
          <div className="cli-promo-code">$ kb post "Hello, koshi!"</div>
          <div className="cli-promo-hint">Try posting via the CLI</div>
        </div>
      )}

      {loading ? (
        <FeedSkeleton />
      ) : error && posts.length === 0 ? (
        <div className="error">{error}</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <span className="empty-text">No posts yet</span>
        </div>
      ) : (
        <div className="post-list">
          {posts.map((post) => (
            <PostCard key={post.id || post._id} post={post} />
          ))}
        </div>
      )}

      <div className="cli-promo">
        <div className="cli-promo-title">🌟 Use koshi more efficiently</div>
        <div className="cli-promo-code">$ npm install -g @ryopc/koshi</div>
        <div className="cli-promo-hint">Follow, search, and more via CLI</div>
      </div>
    </div>
  );
}
