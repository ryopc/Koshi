import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../utils/api.js';
import { generateKeypair } from '../utils/crypto.js';
import { setSK } from '../utils/storage.js';

export default function RegisterPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [secretKey, setSecretKey] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    setError('');

    if (!u) {
      setError('Please enter a username');
      return;
    }
    if (u.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    setLoading(true);
    try {
      const { secretKey: sk, publicKey: pk } = await generateKeypair();
      const { token } = await api('/auth/register', {
        method: 'POST',
        body: { username: u, publicKey: pk },
      });
      setSK(u, sk);
      setSecretKey(sk);
      const profile = await api(`/users/${u}`, { token });
      login(profile, token);
      toast('Account created!', 'success');
      // Auto-redirect after showing the secret key
      setTimeout(() => navigate('/'), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-title">🌊 koshi register</div>
        <div className="auth-sub">Create a new account</div>
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label>username:</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your-username"
              required
              autoFocus
            />
            <small>3-32 chars. Letters, numbers, hyphens, underscores</small>
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? '...' : 'register'}
          </button>
        </form>

        {secretKey && (
          <div className="auth-secret">
            <strong style={{ color: 'var(--yellow)' }}>🔑 Secret Key (save this!)</strong>
            <div className="secret-key-box">{secretKey}</div>
            <button
              className="btn btn-sm"
              onClick={() => {
                navigator.clipboard.writeText(secretKey).then(() => toast('Copied to clipboard', 'success'));
              }}
            >
              📋 Copy
            </button>
          </div>
        )}

        <p className="auth-link">
          Already have an account? <Link to="/login">Login</Link>
        </p>

        <div className="cli-promo">
          <div className="cli-promo-title">💡 Register via CLI recommended</div>
          <div className="cli-promo-code">$ kb register your-username</div>
          <div className="cli-promo-hint">More secure key management</div>
        </div>
      </div>
    </div>
  );
}
