import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../utils/api.js';
import { signMessage } from '../utils/crypto.js';
import { getSK } from '../utils/storage.js';
import PostCard from '../components/PostCard.jsx';

export default function ProfilePage() {
  const { username: paramUsername } = useParams();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dmContent, setDmContent] = useState('');
  const [dmSending, setDmSending] = useState(false);

  const targetUsername = paramUsername || user?.username;
  const isOwn = user && targetUsername === user.username;

  useEffect(() => {
    if (!targetUsername) {
      navigate('/');
      return;
    }
    loadProfile();

    async function loadProfile() {
      setLoading(true);
      setError('');
      try {
        const p = await api(`/users/${targetUsername}`);
        setProfile(p);
        try {
          const allPosts = await api('/posts/feed?limit=100');
          setPosts(allPosts.filter((p) => p.author?.username === targetUsername));
        } catch {
          // posts fetch is optional
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }, [targetUsername, navigate]);

  const handleSendDM = async () => {
    if (!dmContent.trim() || !profile) return;
    setDmSending(true);
    try {
      const sk = getSK(user.username);
      if (!sk) throw new Error('Secret key not found');
      const sig = await signMessage(dmContent.trim(), sk);
      await api(`/dms/${profile.id}`, {
        method: 'POST',
        body: { content: dmContent.trim(), signature: sig },
      });
      setDmContent('');
      toast(`Message sent to @${targetUsername}`, 'success');
    } catch (e) {
      toast(`Send failed: ${e.message}`, 'error');
    } finally {
      setDmSending(false);
    }
  };

  if (loading) {
    return (
      <div className="skeleton" style={{ marginTop: '1rem' }}>
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        <div className="skeleton-line" style={{ width: '40%' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-page">
        <div className="error-card">
          <p>{error}</p>
          <Link to="/" className="btn">Back</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-profile">
      <div className="feed-header">
        <div className="feed-title">$ cat /etc/passwd | grep {targetUsername}</div>
        <Link to="/" className="btn-link">← Back</Link>
      </div>

      <div className="auth-card profile-card">
        <div className="profile-header">
          <div className="profile-avatar">
            {profile?.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" />
            ) : (
              (profile?.username?.[0] || '?').toUpperCase()
            )}
          </div>
          <div className="profile-info">
            <div className="profile-username">@{profile?.username}</div>
            {profile?.displayName && <div className="profile-display-name">{profile.displayName}</div>}
          </div>
        </div>
        {profile?.bio && <div className="profile-bio">{profile.bio}</div>}
        <div className="profile-stats">
          <span>Followers: {profile?.followersCount ?? 0}</span>
          <span className="stat-sep">|</span>
          <span>Following: {profile?.followingCount ?? 0}</span>
        </div>
      </div>

      {isOwn ? (
        <div className="cli-promo">
          <div className="cli-promo-title">Edit profile via CLI</div>
          <div className="cli-promo-code">$ kb profile edit</div>
        </div>
      ) : (
        <>
          <div className="cli-promo">
            <div className="cli-promo-title">Follow via CLI</div>
            <div className="cli-promo-code">$ kb follow {targetUsername}</div>
          </div>

          {isAuthenticated && (
            <Link to={`/dm/${targetUsername}`} className="btn btn-sm" style={{ width: '100%', textAlign: 'center', marginBottom: '1rem' }}>
              💬 Open DM →
            </Link>
          )}

          {isAuthenticated && (
            <div className="dm-send-form">
              <div className="dm-send-form-header">💬 Send a message to @{targetUsername}</div>
              <textarea
                value={dmContent}
                onChange={(e) => setDmContent(e.target.value)}
                placeholder="Type a message..."
                rows={2}
                maxLength={5000}
              />
              <div className="dm-send-form-footer">
                <span className="char-count">{dmContent.length} / 5000</span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSendDM}
                  disabled={!dmContent.trim() || dmSending}
                >
                  {dmSending ? '...' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="section-title">📝 Posts ({posts.length})</div>

      {posts.length === 0 ? (
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
    </div>
  );
}
