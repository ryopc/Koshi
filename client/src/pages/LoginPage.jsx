import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { api } from '../utils/api.js';
import { signMessage } from '../utils/crypto.js';
import { getSK } from '../utils/storage.js';

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    setError('');

    if (!u) {
      setError('Please enter your username');
      return;
    }

    const sk = getSK(u);
    if (!sk) {
      setError('Secret key not found. Please register first.');
      return;
    }

    setLoading(true);
    try {
      const sig = await signMessage(`koshi:login:${u}`, sk);
      const { token } = await api('/auth/login', {
        method: 'POST',
        body: { username: u, signature: sig },
      });
      const profile = await api(`/users/${u}`, { token });
      login(profile, token);
      toast('Logged in', 'success');
      navigate('/');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-title">🌊 koshi login</div>
        <div className="auth-sub">Terminal-native decentralized SNS</div>
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
            <small>Enter your registered username</small>
          </div>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? '...' : 'login'}
          </button>
        </form>
        <p className="auth-link">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
        <div className="cli-promo">
          <div className="cli-promo-title">💡 Login via CLI recommended</div>
          <div className="cli-promo-code">$ kb login</div>
          <div className="cli-promo-hint">More secure authentication</div>
        </div>
      </div>
    </div>
  );
}
