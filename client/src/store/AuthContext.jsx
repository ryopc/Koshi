import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api.js';
import { getToken, setToken, getUser, setUser, clearAll, getSK, setSK } from '../utils/storage.js';
import { signMessage } from '../utils/crypto.js';
import { useToast } from '../components/Toast.jsx';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  const [token, setTokenState] = useState(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const login = useCallback((newUser, newToken) => {
    setUserState(newUser);
    setTokenState(newToken);
    if (newUser && newToken) {
      setUser(newUser);
      setToken(newToken);
    } else {
      clearAll();
    }
  }, []);

  const logout = useCallback(() => {
    login(null, null);
    toast('Logged out', 'info');
  }, [login, toast]);

  const initAuth = useCallback(async () => {
    const su = getUser();
    const st = getToken();
    const ss = su && st ? getSK(su.username) : null;

    if (su && st && ss) {
      try {
        const sig = await signMessage(`koshi:login:${su.username}`, ss);
        const { token: newToken } = await api('/auth/login', {
          method: 'POST',
          body: { username: su.username, signature: sig },
        });
        const profile = await api(`/users/${su.username}`, { token: newToken });
        login(profile, newToken);
      } catch {
        clearAll();
      }
    }
    setLoading(false);
  }, [login]);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    isAuthenticated: !!user && !!token,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
