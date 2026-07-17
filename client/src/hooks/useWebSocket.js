import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from '../store/AuthContext.jsx';

const WS_URL = import.meta.env.DEV
  ? ''
  : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'ws://localhost:3000'
    : 'wss://koshi-api.ryopc.f5.si') + '/ws';

export function useWebSocket(onMessage) {
  const { token, isAuthenticated } = useAuth();
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const timerRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!token || wsRef.current) return;

    try {
      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          onMessageRef.current?.(msg);
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (token) {
          timerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => setConnected(false);
    } catch { /* ignore connection errors */ }
  }, [token]);

  const disconnect = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const send = useCallback((type, payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
    }
    return () => disconnect();
  }, [isAuthenticated, connect, disconnect]);

  return { connected, send };
}
