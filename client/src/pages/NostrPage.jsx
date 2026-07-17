import React from 'react';
import { useAuth } from '../store/AuthContext.jsx';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
];

export default function NostrPage() {
  const { user } = useAuth();
  const hasNostr = user?.nostrConfigured;

  return (
    <div className="page-nostr">
      <div className="feed-header">
        <div className="feed-title">🔑 Nostr Settings</div>
      </div>

      <div className="auth-card" style={{ marginBottom: '1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <div className="section-label">Nostr Integration Status</div>
          <div className="nostr-status">
            {hasNostr ? (
              <>
                <div className="nostr-status-online">✓ Nostr configured</div>
                <div className="nostr-status-hint">Keys stored locally</div>
              </>
            ) : (
              <>
                <div className="nostr-status-offline">○ Not configured</div>
                <div className="nostr-status-hint">Use CLI to generate keys</div>
              </>
            )}
          </div>
        </div>

        <div className="nostr-actions">
          <div className="section-label">⚡ Quick Actions</div>
          <div className="cli-promo" style={{ marginTop: '0.5rem' }}>
            <div className="cli-promo-code" style={{ fontSize: '0.75rem' }}>$ kb nostr key generate</div>
            <div className="cli-promo-hint">Generate Nostr keypair via CLI</div>
          </div>
          <div className="cli-promo" style={{ marginTop: '0.5rem' }}>
            <div className="cli-promo-code" style={{ fontSize: '0.75rem' }}>$ kb nostr push</div>
            <div className="cli-promo-hint">Push posts to Nostr relays</div>
          </div>
          <div className="cli-promo" style={{ marginTop: '0.5rem' }}>
            <div className="cli-promo-code" style={{ fontSize: '0.75rem' }}>$ kb nostr pull</div>
            <div className="cli-promo-hint">Pull events from Nostr relays</div>
          </div>
        </div>
      </div>

      <div className="feed-header" style={{ marginTop: '1rem' }}>
        <div className="feed-title">📡 Relays</div>
      </div>

      <div className="relay-list">
        {DEFAULT_RELAYS.map((relay) => (
          <div key={relay} className="relay-item">
            <span className="relay-dot">●</span>
            <span className="relay-url">{relay}</span>
          </div>
        ))}
      </div>

      <div className="cli-promo" style={{ marginTop: '0.5rem' }}>
        <div className="cli-promo-code" style={{ fontSize: '0.7rem' }}>$ kb nostr relay add wss://...</div>
        <div className="cli-promo-hint">Add relays via CLI</div>
      </div>

      <div className="nostr-footer-hint">
        💡 Nostr key management is available via the CLI: <code>kb nostr --help</code>
      </div>
    </div>
  );
}
