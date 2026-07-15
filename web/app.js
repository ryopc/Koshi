/* ====================================================================
 * koshi – Terminal-Native Decentralized SNS
 * Web Application (Vanilla JS SPA)
 * License: MIT
 * ====================================================================
 * Dependencies loaded from CDN:
 *   - @noble/ed25519 (ed25519 crypto)
 *   - @noble/hashes/sha512 (hash for ed25519)
 * ==================================================================== */

import * as ed from 'https://esm.sh/@noble/ed25519@2.1.0'
import { sha512 } from 'https://esm.sh/@noble/hashes@1.5.0/sha512.js'

// ── Crypto Setup ─────────────────────────────────────────────────────────────
ed.etc.sha512Sync = (...m) => {
  const total = m.reduce((sum, a) => sum + a.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const a of m) { merged.set(a, offset); offset += a.length }
  return sha512(merged)
}

// ── Constants ────────────────────────────────────────────────────────────────
const API = (() => {
  // In production, use env variable or default to the production API
  const script = document.currentScript
  const base = script?.getAttribute('data-api') || ''
  return base || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://koshi-api.ryopc.f5.si')
})()

const LS_KEYS = {
  TOKEN: 'koshi:token',
  USER: 'koshi:user',
  SECRET: (u) => `koshi:sk:${u}`,
}

// ── Utility Functions ────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel)
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)]
const html = (str) => {
  const t = document.createElement('template')
  t.innerHTML = str.trim()
  return t.content.firstChild
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const timeAgo = (iso) => {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000
  if (sec < 60) return 'たった今'
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}日前`
  return new Date(iso).toLocaleDateString('ja-JP')
}

function encodeHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function decodeHex(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

// ── Toast Notifications ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  let container = $('#toast-container')
  if (!container) {
    container = html('<div id="toast-container" class="toast-container"></div>')
    document.body.appendChild(container)
  }
  const toast = html(`<div class="toast ${type}">${message}</div>`)
  container.appendChild(toast)
  setTimeout(() => {
    toast.classList.add('out')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

// ── API Client ───────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const { token, body, ...rest } = options
  const headers = { 'Content-Type': 'application/json' }
  const t = token || getToken()
  if (t) headers['Authorization'] = `Bearer ${t}`

  const res = await fetch(`${API}/api${path}`, {
    ...rest,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
  return data
}

// ── Local Storage Helpers ────────────────────────────────────────────────────
function getToken() { return localStorage.getItem(LS_KEYS.TOKEN) }
function setToken(t) { localStorage.setItem(LS_KEYS.TOKEN, t) }
function clearToken() { localStorage.removeItem(LS_KEYS.TOKEN) }

function getUser() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.USER)) } catch { return null }
}
function setUser(u) { localStorage.setItem(LS_KEYS.USER, JSON.stringify(u)) }
function clearUser() { localStorage.removeItem(LS_KEYS.USER) }

function getSecretKey(username) { return localStorage.getItem(LS_KEYS.SECRET(username)) }
function setSecretKey(username, sk) { localStorage.setItem(LS_KEYS.SECRET(username), sk) }
function clearSecretKey(username) { localStorage.removeItem(LS_KEYS.SECRET(username)) }

function clearAll() {
  const u = getUser()
  if (u) clearSecretKey(u.username)
  clearToken()
  clearUser()
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  token: null,
  initialized: false,
  feed: [],
  feedLoading: false,
}

function updateAuth(user, token) {
  state.user = user
  state.token = token
  if (user && token) {
    setUser(user)
    setToken(token)
  } else {
    clearAll()
  }
  updateSidebar()
}

// ── Routing ──────────────────────────────────────────────────────────────────
function getRoute() {
  const hash = location.hash.slice(1) || '/'
  const parts = hash.split('/').filter(Boolean)
  return { path: hash, parts, page: parts[0] || 'feed' }
}

function navigate(href) {
  history.pushState(null, '', `#${href}`)
  render()
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function updateSidebar() {
  const el = $('#sidebar-user')
  const name = $('#sidebar-username')
  const navProfile = $('#nav-profile')
  if (state.user) {
    el.style.display = 'flex'
    name.textContent = `@${state.user.username}`
    navProfile.style.display = 'block'
  } else {
    el.style.display = 'none'
    navProfile.style.display = 'none'
  }
  // Update active nav
  const route = getRoute()
  $$('.sidebar-nav a').forEach(a => {
    const href = a.getAttribute('href')
    a.classList.toggle('active', href === `#${route.path}` || (route.page === 'feed' && href === '#/'))
  })
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  if (!state.initialized) return
  if (!state.user) {
    const route = getRoute()
    if (route.page === 'register') renderRegister()
    else renderLogin()
    return
  }
  updateSidebar()
  const route = getRoute()
  switch (route.page) {
    case 'profile': renderProfile(route.parts[1]); break
    default: renderFeed(); break
  }
}

// =============================================================================
// PAGE: Login
// =============================================================================
function renderLogin() {
  const main = $('#main-content')
  main.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <h1 class="auth-title">🌊 koshi</h1>
        <p class="auth-subtitle">ターミナルネイティブな分散 SNS</p>
        <form id="login-form" class="auth-form">
          <div class="form-group">
            <label>ユーザー名</label>
            <input type="text" id="login-username" placeholder="gast-yourname" required autofocus />
          </div>
          <div id="login-error" class="error-msg" style="display:none;"></div>
          <button type="submit" id="login-btn" class="btn-primary">ログイン</button>
        </form>
        <p class="auth-link">
          アカウントをお持ちでない方は <a href="#/register" data-nav>新規登録</a>
        </p>
        <div class="auth-notice">
          💡 秘密鍵は端末に保存されます<br />
          アカウントは複数端末で共有できません
        </div>
      </div>
    </div>`

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const username = $('#login-username').value.trim().toLowerCase()
    const errorEl = $('#login-error')
    const btn = $('#login-btn')

    if (!username.startsWith('gast-')) {
      errorEl.textContent = 'ユーザー名は gast- から始まる必要があります'
      errorEl.style.display = 'block'
      return
    }

    const secretKey = getSecretKey(username)
    if (!secretKey) {
      errorEl.textContent = 'この端末に秘密鍵が見つかりません。登録してください。'
      errorEl.style.display = 'block'
      return
    }

    btn.disabled = true
    btn.textContent = 'ログイン中...'
    errorEl.style.display = 'none'

    try {
      const challenge = `koshi:login:${username}`
      const sigBytes = ed.sign(new TextEncoder().encode(challenge), decodeHex(secretKey))
      const signature = encodeHex(sigBytes)
      const { token } = await api('/auth/login', { method: 'POST', body: { username, signature } })
      const profile = await api(`/users/${username}`, { token })
      updateAuth(profile, token)
      navigate('/')
    } catch (e) {
      errorEl.textContent = e.message
      errorEl.style.display = 'block'
    } finally {
      btn.disabled = false
      btn.textContent = 'ログイン'
    }
  })
}

// =============================================================================
// PAGE: Register
// =============================================================================
function renderRegister() {
  const main = $('#main-content')
  main.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <h1 class="auth-title">🌊 koshi</h1>
        <p class="auth-subtitle">新規アカウント登録</p>
        <form id="register-form" class="auth-form">
          <div class="form-group">
            <label>ユーザー名</label>
            <input type="text" id="reg-username" placeholder="gast-yourname" required autofocus />
            <small class="form-hint">3〜32文字の英数字、ハイフン、アンダースコア。gast- から始めてください</small>
          </div>
          <div id="register-error" class="error-msg" style="display:none;"></div>
          <div id="register-secret" class="auth-secret" style="display:none;"></div>
          <button type="submit" id="register-btn" class="btn-primary">登録</button>
        </form>
        <p class="auth-link">
          すでにアカウントをお持ちの方は <a href="#/" data-nav>ログイン</a>
        </p>
      </div>
    </div>`

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const username = $('#reg-username').value.trim().toLowerCase()
    const errorEl = $('#register-error')
    const secretEl = $('#register-secret')
    const btn = $('#register-btn')

    if (!username.startsWith('gast-')) {
      errorEl.textContent = 'ユーザー名は gast- から始まる必要があります'
      errorEl.style.display = 'block'
      return
    }

    btn.disabled = true
    btn.textContent = '登録中...'
    errorEl.style.display = 'none'
    secretEl.style.display = 'none'

    try {
      // Generate Ed25519 keypair
      const secretKey = ed.utils.randomPrivateKey()
      const publicKey = ed.getPublicKey(secretKey)
      const skHex = encodeHex(secretKey)
      const pkHex = encodeHex(publicKey)

      // Register on server
      const { token } = await api('/auth/register', {
        method: 'POST',
        body: { username, publicKey: pkHex },
      })

      // Save secret key locally
      setSecretKey(username, skHex)

      // Get profile and log in
      const profile = await api(`/users/${username}`, { token })
      updateAuth(profile, token)

      // Show secret key once
      secretEl.innerHTML = `
        <strong>🔑 秘密鍵 (必ず保存してください)</strong>
        <div style="margin-top:0.5rem;font-family:monospace;font-size:0.7rem;word-break:break-all;">${skHex}</div>
        <button id="copy-secret-btn" class="btn-secondary" style="margin-top:0.5rem;padding:0.3rem 0.8rem;font-size:0.75rem;">📋 コピー</button>
      `
      secretEl.style.display = 'block'
      const copyBtn = $('#copy-secret-btn')
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(skHex).then(() => {
            copyBtn.textContent = '✅ コピーしました！'
            setTimeout(() => { copyBtn.textContent = '📋 コピー' }, 2000)
          }).catch(() => {
            showToast('コピーに失敗しました', 'error')
          })
        })
      }

      showToast('アカウントを作成しました！', 'success')

      // Navigate to feed after short delay
      setTimeout(() => navigate('/'), 2000)
    } catch (e) {
      errorEl.textContent = e.message
      errorEl.style.display = 'block'
    } finally {
      btn.disabled = false
      btn.textContent = '登録'
    }
  })
}

// =============================================================================
// PAGE: Feed / Timeline
// =============================================================================
let feedPollTimer = null

function renderFeed() {
  const main = $('#main-content')
  main.innerHTML = `
    <div class="feed-page">
      <div class="feed-header">
        <h2>🌊 タイムライン</h2>
        <span class="live-badge">● LIVE</span>
      </div>
      <div id="post-form-container">
        <div class="post-form">
          <textarea id="post-input" placeholder="いまどうしてる？" maxlength="2000" rows="2"></textarea>
          <div class="post-form-footer">
            <span class="char-count" id="char-count">0 / 2000</span>
            <button id="post-btn" class="btn-primary">投稿</button>
          </div>
        </div>
        <div id="post-error" class="error-msg" style="display:none;"></div>
      </div>
      <div id="feed-list">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
    </div>`

  // Character count
  $('#post-input').addEventListener('input', () => {
    const len = $('#post-input').value.length
    const el = $('#char-count')
    el.textContent = `${len} / 2000`
    el.className = 'char-count' + (len > 1900 ? ' warn' : '') + (len > 2000 ? ' over' : '')
  })

  // Post submission
  $('#post-btn').addEventListener('click', submitPost)
  $('#post-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitPost(e)
  })

  // Start feed polling
  loadFeed()
  startFeedPolling()
}

async function submitPost(e) {
  if (e) e.preventDefault()
  const input = $('#post-input')
  const btn = $('#post-btn')
  const errorEl = $('#post-error')
  const content = input.value.trim()

  if (!content) return
  if (!state.user || !state.token) return

  btn.disabled = true
  btn.textContent = '投稿中...'
  errorEl.style.display = 'none'

  try {
    const secretKey = getSecretKey(state.user.username)
    if (!secretKey) throw new Error('秘密鍵が見つかりません')

    const sigBytes = ed.sign(new TextEncoder().encode(content), decodeHex(secretKey))
    const signature = encodeHex(sigBytes)

    await api('/posts', {
      method: 'POST',
      body: { content, signature },
      token: state.token,
    })
    input.value = ''
    $('#char-count').textContent = '0 / 2000'
    showToast('投稿しました', 'success')
    loadFeed() // Refresh immediately
  } catch (e) {
    errorEl.textContent = e.message
    errorEl.style.display = 'block'
  } finally {
    btn.disabled = false
    btn.textContent = '投稿'
  }
}

async function loadFeed() {
  if (!state.token) return
  const list = $('#feed-list')
  if (!list) return
  state.feedLoading = true

  try {
    const posts = await api('/posts/feed?limit=50', { token: state.token })
    state.feed = posts
    state.feedLoading = false
    renderFeedPosts(posts)
  } catch (e) {
    state.feedLoading = false
    if (list) {
      list.innerHTML = `<div class="empty-feed"><p>⚠️ フィードの読み込みに失敗しました</p><p style="font-size:0.8rem;color:var(--text3);">${e.message}</p></div>`
    }
  }
}

function renderFeedPosts(posts) {
  const list = $('#feed-list')
  if (!list) return

  if (!posts.length) {
    list.innerHTML = `
      <div class="empty-feed">
        <div class="empty-icon">🌱</div>
        <p>まだ投稿がありません</p>
        <p style="font-size:0.85rem;color:var(--text3);">最初の投稿をしてみましょう！</p>
      </div>`
    return
  }

  list.innerHTML = posts.map(post => `
    <div class="post-card" data-id="${post.id}">
      <div class="post-header">
        <span class="post-author" data-username="${post.author.username}">@${post.author.username}</span>
        <span class="post-date" title="${new Date(post.createdAt).toLocaleString('ja-JP')}">${timeAgo(post.createdAt)}</span>
      </div>
      <div class="post-content">${escapeHtml(post.content)}</div>
      <div class="post-footer">
        <span class="sig-badge">✓ ed25519署名済み</span>
      </div>
    </div>
  `).join('')

  // Click to profile
  $$('.post-author').forEach(el => {
    el.addEventListener('click', () => navigate(`/profile/${el.dataset.username}`))
  })
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function startFeedPolling() {
  stopFeedPolling()
  feedPollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadFeed()
  }, 3000)
}

function stopFeedPolling() {
  if (feedPollTimer) { clearInterval(feedPollTimer); feedPollTimer = null }
}

// =============================================================================
// PAGE: Profile
// =============================================================================
async function renderProfile(username) {
  const main = $('#main-content')
  const targetUser = username || state.user?.username

  if (!targetUser) { navigate('/'); return }

  main.innerHTML = `
    <div class="profile-page">
      <div class="loading-page"><p>読み込み中...</p></div>
    </div>`

  try {
    const profile = await api(`/users/${targetUser}`, { token: state.token })
    const posts = await api(`/users/${targetUser}/posts`, { token: state.token })
    renderProfileContent(profile, posts)
  } catch (e) {
    main.innerHTML = `
      <div class="error-page">
        <div class="error-card">
          <p>⚠️ ${e.message}</p>
          <button class="btn-secondary" onclick="history.back()">戻る</button>
        </div>
      </div>`
  }
}

function renderProfileContent(profile, posts) {
  const main = $('#main-content')
  const isMe = state.user?.id === profile.id
  const avatarChar = profile.displayName?.[0] || profile.username[0] || '?'

  main.innerHTML = `
    <div class="profile-page">
      <div class="profile-card">
        <div class="profile-avatar">
          ${profile.avatarUrl
            ? `<img src="${profile.avatarUrl}" alt="${profile.username}" />`
            : avatarChar.toUpperCase()
          }
        </div>
        <div class="profile-info">
          <div class="profile-username">@${profile.username}</div>
          ${profile.displayName ? `<div class="profile-displayname">${escapeHtml(profile.displayName)}</div>` : ''}
          ${profile.bio ? `<div class="profile-bio">${escapeHtml(profile.bio)}</div>` : ''}
          <div class="profile-stats">
            <span><strong>${profile.followersCount ?? 0}</strong> フォロワー</span>
            <span><strong>${profile.followingCount ?? 0}</strong> フォロー中</span>
          </div>
          ${!isMe ? `
            <div class="profile-actions">
              <button id="btn-follow" class="${profile.isFollowing ? 'btn-unfollow' : 'btn-follow'}">
                ${profile.isFollowing ? 'フォロー解除' : 'フォローする'}
              </button>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="profile-posts">
        <h3>📝 投稿</h3>
        <div id="profile-posts-list">
          ${posts.length === 0
            ? '<p class="empty-msg">まだ投稿がありません</p>'
            : posts.map(post => `
              <div class="post-card">
                <div class="post-header">
                  <span class="post-author" data-username="${post.author.username}">@${post.author.username}</span>
                  <span class="post-date" title="${new Date(post.createdAt).toLocaleString('ja-JP')}">${timeAgo(post.createdAt)}</span>
                </div>
                <div class="post-content">${escapeHtml(post.content)}</div>
                <div class="post-footer">
                  <span class="sig-badge">✓ ed25519署名済み</span>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>`

  // Click to profile from profile page posts
  $$('#profile-posts-list .post-author').forEach(el => {
    el.addEventListener('click', () => navigate(`/profile/${el.dataset.username}`))
  })

  // Follow button
  const followBtn = $('#btn-follow')
  if (followBtn) {
    followBtn.addEventListener('click', async () => {
      followBtn.disabled = true
      try {
        if (profile.isFollowing) {
          await api(`/users/${profile.id}/follow`, { method: 'DELETE', token: state.token })
          profile.isFollowing = false
          followBtn.className = 'btn-follow'
          followBtn.textContent = 'フォローする'
          showToast('フォロー解除しました', 'info')
        } else {
          await api(`/users/${profile.id}/follow`, { method: 'POST', token: state.token })
          profile.isFollowing = true
          followBtn.className = 'btn-unfollow'
          followBtn.textContent = 'フォロー解除'
          showToast('フォローしました', 'success')
        }
      } catch (e) {
        showToast(e.message, 'error')
      } finally {
        followBtn.disabled = false
      }
    })
  }
}

// =============================================================================
// Initialization
// =============================================================================
async function init() {
  // Try to restore session
  const savedUser = getUser()
  const savedToken = getToken()
  const savedSecret = savedUser ? getSecretKey(savedUser.username) : null

  if (savedUser && savedToken && savedSecret) {
    try {
      // Verify token with server
      const result = await api('/auth/verify', { token: savedToken })
      if (result.valid && result.user) {
        updateAuth(result.user, savedToken)
      } else {
        // Token expired — try to re-authenticate
        const challenge = `koshi:login:${savedUser.username}`
        const sigBytes = ed.sign(new TextEncoder().encode(challenge), decodeHex(savedSecret))
        const signature = encodeHex(sigBytes)
        const { token } = await api('/auth/login', {
          method: 'POST',
          body: { username: savedUser.username, signature },
        })
        const profile = await api(`/users/${savedUser.username}`, { token })
        updateAuth(profile, token)
      }
    } catch {
      // Network error — restore from cache anyway
      state.user = savedUser
      state.token = savedToken
      updateSidebar()
    }
  }

  state.initialized = true
  $('#loading-screen').style.display = 'none'
  $('#app').style.display = 'flex'
  render()
}

// ── Event Listeners ──────────────────────────────────────────────────────────
// Navigation clicks
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-nav]')
  if (link) {
    e.preventDefault()
    const href = link.getAttribute('href')
    if (href) navigate(href.slice(1))
  }
})

// Browser back/forward
window.addEventListener('popstate', render)

// Logout
document.addEventListener('click', (e) => {
  if (e.target.id === 'btn-logout') {
    updateAuth(null, null)
    // Also call server logout to clear cookie
    api('/auth/logout', { method: 'POST' }).catch(() => {})
    navigate('/')
    showToast('ログアウトしました', 'info')
  }
})

// Visibility change — refresh feed when coming back
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user && getRoute().page === 'feed') {
    loadFeed()
  }
})

// ── Start ────────────────────────────────────────────────────────────────────
init()
