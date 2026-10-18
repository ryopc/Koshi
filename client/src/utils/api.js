import { getToken } from './storage.js';

// ---------------------------------------------------------------------------
// Dynamic API base resolution
//
// In v3.1.6 the Web UI discovers its API base URL from `config.serverUrl`
// exposed by the server's `/api/config` endpoint.  When `serverUrl` is absent
// (serverless / same-origin mode), the client falls back to relative URLs so
// that the API and Web UI always share the same origin.
// ---------------------------------------------------------------------------

let _resolvedBase = null; // cached after first fetch
let _resolved = false;

// Build-time override: VITE_API_BASE_URL forces a remote server (client-only build)
const BUILD_API_BASE = import.meta.env.VITE_API_BASE_URL;

async function resolveApiBase() {
    if (_resolved) return _resolvedBase;
    _resolved = true;

    // Dev mode: Vite proxy handles /api
    if (import.meta.env.DEV) {
        _resolvedBase = BUILD_API_BASE || '';
        return _resolvedBase;
    }

    // Build-time override takes priority — client-only mode, no /api/config lookup
    if (BUILD_API_BASE) {
        _resolvedBase = BUILD_API_BASE.replace(/\/$/, '');
        return _resolvedBase;
    }

    // Ask the server for runtime config (non-recursive plain fetch)
    try {
        const res = await fetch('/api/config', { cache: 'no-store' });
        if (res.ok) {
            const cfg = await res.json();
            if (cfg.serverUrl) {
                _resolvedBase = cfg.serverUrl.replace(/\/$/, '');
                return _resolvedBase;
            }
        }
    } catch {
        // Server didn't respond — fall through to hostname-based fallback
    }

    // Serverless / same-origin fallback
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        _resolvedBase = ''; // relative → same-origin
    } else {
        _resolvedBase = `https://${window.location.host}`;
    }

    return _resolvedBase;
}

export async function api(path, opts = {}) {
    const { token, body, method = 'GET' } = opts;
    const headers = { 'Content-Type': 'application/json' };
    const t = token || getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;

    const base = await resolveApiBase();

    const res = await fetch(`${base}/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    return data;
}