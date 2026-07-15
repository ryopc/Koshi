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
  const script = document.currentScript
  const base = script?.getAttribute('data-api') || ''
  return base || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://koshi-api.ryopc.f5.si')
})()

const WS_URL = API.replace(/^http/, 'ws').replace(/\/$/, '')

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
const escapeHtml = (str) => {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
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
  const toast = html(`<div class="toast ${type}">${escapeHtml(message)}</div>`)
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

// ── WebSocket Client ─────────────────────────────────────────────────────────
let ws = null
let wsReconnectTimer = null
let wsReconnectDelay = 1000

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  if (!state.token) return

  try {
    ws = new WebSocket(`${WS_URL}/ws?token=${state.token}`)
  } catch { return }

  ws.onopen = () => {
    wsReconnectDelay = 1000
    showToast('🌐 リアルタイム接続', 'info')
    updateConnectionStatus(true)
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      handleWsMessage(msg)
    } catch {}
  }

  ws.onclose = () => {
    updateConnectionStatus(false)
    // Reconnect with backoff
    if (state.token) {
      wsReconnectTimer = setTimeout(() => {
        wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 30000)
        connectWebSocket()
      }, wsReconnectDelay)
    }
  }

  ws.onerror = () => {}
}

function disconnectWebSocket() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null }
  if (ws) { ws.close(); ws = null }
  updateConnectionStatus(false)
}

function sendWs(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }))
  }
}

function handleWsMessage(msg) {
  const { type, payload } = msg
  switch (type) {
    case 'connected':
      break
    case 'post_created':
    case 'post:created':
      onNewPost(payload)
      break
    case 'dm_received':
      onDmReceived(payload)
      break
    case 'pong':
      break
    case 'error':
      console.warn('WS error:', payload?.message)
      break
  }
}

function onNewPost(post) {
  // Don't duplicate own posts (already shown from submit)
  if (state.feed.some(p => p.id === post.id)) return
  state.feed.unshift(post)
  if (getRoute().page === 'feed') {
    const list = $('#feed-list')
    if (list) {
      // Remove empty state if present
      const empty = list.querySelector('.empty-feed')
      if (empty) empty.remove()
      // Prepend new post with highlight
      const card = createPostCard(post, true)
      list.prepend(card)
      showToast(`📝 ${post.author.username} が新規投稿`, 'info')
    }
  }
  // Update DM badge if needed
}

function onDmReceived(dm) {
  state.unreadDms = (state.unreadDms || 0) + 1
  updateDmBadge()
  showToast(`💬 ${dm.from.username} からDM`, 'info')
}

function updateConnectionStatus(connected) {
  const badge = $('.live-badge')
  if (badge) {
    badge.textContent = connected ? '● LIVE' : '○ OFFLINE'
    badge.style.background = connected ? '#ff4444' : '#666'
  }
}

function updateDmBadge() {
  const badge = $('#dm-badge')
  if (!badge) return
  if (state.unreadDms > 0) {
    badge.textContent = state.unreadDms
    badge.style.display = 'inline'
  } else {
    badge.style.display = 'none'
  }
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  token: null,
  initialized: false,
  feed: [],
  feedLoading: false,
  unreadDms: 0,
}

function updateAuth(user, token) {
  state.user = user
  state.token = token
  if (user && token) {
    setUser(user)
    setToken(token)
    connectWebSocket()
    pollUnreadDms()
  } else {
    disconnectWebSocket()
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
  if (state.user) {
    el.style.display = 'flex'
    name.textContent = `@${state.user.username}`
  } else {
    el.style.display = 'none'
  }
  const route = getRoute()
  // Show/hide nav items based on auth
  const navSearch = $('#nav-search')
  const navDms = $('#nav-dms')
  const navSettings = $('#nav-settings')
  const navProfile = $('#nav-profile')
  if (state.user) {
    if (navSearch) navSearch.style.display = ''
    if (navDms) navDms.style.display = ''
    if (navSettings) navSettings.style.display = ''
    if (navProfile) navProfile.style.display = ''
  } else {
    if (navSearch) navSearch.style.display = 'none'
    if (navDms) navDms.style.display = 'none'
    if (navSettings) navSettings.style.display = 'none'
    if (navProfile) navProfile.style.display = 'none'
  }
  // Update active nav
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
    case 'search': renderSearch(); break
    case 'dms': renderDms(); break
    case 'settings': renderSettings(); break
    default: renderFeed(); break
  }
}

// =============================================================================
// Shared: Post Card
// =============================================================================
function createPostCard(post, isNew = false) {
  const card = document.createElement('div')
  card.className = 'post-card' + (isNew ? ' new' : '')
  card.dataset.id = post.id
  card.innerHTML = `
    <div class="post-header">
      <span class="post-author" data-username="${escapeHtml(post.author.username)}">@${escapeHtml(post.author.username)}</span>
      <span class="post-date" title="${new Date(post.createdAt).toLocaleString('ja-JP')}">${timeAgo(post.createdAt)}</span>
    </div>
    <div class="post-content">${escapeHtml(post.content)}</div>
    <div class="post-footer">
      <span class="sig-badge">✓ ed25519署名済み</span>
    </div>`
  card.querySelector('.post-author').addEventListener('click', () => navigate(`/profile/${post.author.username}`))
  return card
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
      const secretKey = ed.utils.randomPrivateKey()
      const publicKey = ed.getPublicKey(secretKey)
      const skHex = encodeHex(secretKey)
      const pkHex = encodeHex(publicKey)

      const { token } = await api('/auth/register', {
        method: 'POST',
        body: { username, publicKey: pkHex },
      })

      setSecretKey(username, skHex)
      const profile = await api(`/users/${username}`, { token })
      updateAuth(profile, token)

      secretEl.innerHTML = `
        <strong>🔑 秘密鍵 (必ず保存してください)</strong>
        <div style="margin-top:0.5rem;font-family:monospace;font-size:0.7rem;word-break:break-all;">${skHex}</div>
        <button id="copy-secret-btn" class="btn-secondary" style="margin-top:0.5rem;padding:0.3rem 0.8rem;font-size:0.75rem;">📋 コピー</button>`
      secretEl.style.display = 'block'
      const copyBtn = $('#copy-secret-btn')
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(skHex).then(() => {
            copyBtn.textContent = '✅ コピーしました！'
            setTimeout(() => { copyBtn.textContent = '📋 コピー' }, 2000)
          }).catch(() => { showToast('コピーに失敗しました', 'error') })
        })
      }

      showToast('アカウントを作成しました！', 'success')
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

  $('#post-input').addEventListener('input', () => {
    const len = $('#post-input').value.length
    const el = $('#char-count')
    el.textContent = `${len} / 2000`
    el.className = 'char-count' + (len > 1900 ? ' warn' : '') + (len > 2000 ? ' over' : '')
  })

  $('#post-btn').addEventListener('click', submitPost)
  $('#post-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitPost(e)
  })

  loadFeed()
  // Ensure WS is connected
  if (state.token && (!ws || ws.readyState !== WebSocket.OPEN)) connectWebSocket()
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

    // Try WebSocket first, fall back to REST
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendWs('post:create', { content, signature })
    } else {
      await api('/posts', { method: 'POST', body: { content, signature }, token: state.token })
    }

    input.value = ''
    $('#char-count').textContent = '0 / 2000'
    showToast('投稿しました', 'success')
    // Feed will update via WS event, but also reload as fallback
    setTimeout(() => loadFeed(), 500)
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
      list.innerHTML = `<div class="empty-feed"><p>⚠️ フィードの読み込みに失敗しました</p><p style="font-size:0.8rem;color:var(--text3);">${escapeHtml(e.message)}</p></div>`
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

  list.innerHTML = ''
  posts.forEach(post => list.appendChild(createPostCard(post)))
}

// =============================================================================
// PAGE: Profile
// =============================================================================
async function renderProfile(username) {
  const main = $('#main-content')
  const targetUser = username || state.user?.username
  if (!targetUser) { navigate('/'); return }

  main.innerHTML = `<div class="profile-page"><div class="loading-page"><p>読み込み中...</p></div></div>`

  try {
    const profile = await api(`/users/${targetUser}`, { token: state.token })
    const posts = await api(`/users/${targetUser}/posts`, { token: state.token })
    renderProfileContent(profile, posts)
  } catch (e) {
    main.innerHTML = `
      <div class="error-page">
        <div class="error-card">
          <p>⚠️ ${escapeHtml(e.message)}</p>
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
            ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(profile.username)}" />`
            : avatarChar.toUpperCase()}
        </div>
        <div class="profile-info">
          <div class="profile-username">@${escapeHtml(profile.username)}</div>
          ${profile.displayName ? `<div class="profile-displayname">${escapeHtml(profile.displayName)}</div>` : ''}
          ${profile.bio ? `<div class="profile-bio">${escapeHtml(profile.bio)}</div>` : ''}
          <div class="profile-stats">
            <span><strong>${profile.followersCount ?? 0}</strong> フォロワー</span>
            <span><strong>${profile.followingCount ?? 0}</strong> フォロー中</span>
          </div>
          <div class="profile-actions">
            ${!isMe
              ? `<button id="btn-follow" class="${profile.isFollowing ? 'btn-unfollow' : 'btn-follow'}">
                  ${profile.isFollowing ? 'フォロー解除' : 'フォローする'}
                </button>`
              : `<button id="btn-edit-profile" class="btn-secondary">プロフィール編集</button>`
            }
            ${!isMe ? `<button id="btn-dm-user" class="btn-secondary" style="margin-left:0.5rem;">💬 DM</button>` : ''}
          </div>
        </div>
      </div>
      <div class="profile-posts">
        <h3>📝 投稿</h3>
        <div id="profile-posts-list">
          ${posts.length === 0
            ? '<p class="empty-msg">まだ投稿がありません</p>'
            : ''}
        </div>
      </div>
    </div>`

  const postsList = $('#profile-posts-list')
  if (posts.length > 0) {
    posts.forEach(post => postsList.appendChild(createPostCard(post)))
  }

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
      } catch (e) { showToast(e.message, 'error') }
      finally { followBtn.disabled = false }
    })
  }

  // DM button
  const dmBtn = $('#btn-dm-user')
  if (dmBtn) {
    dmBtn.addEventListener('click', () => navigate(`/dms/${profile.id}`))
  }

  // Edit profile button
  const editBtn = $('#btn-edit-profile')
  if (editBtn) {
    editBtn.addEventListener('click', () => navigate('/settings'))
  }
}

// =============================================================================
// PAGE: User Search
// =============================================================================
let searchDebounce = null

function renderSearch() {
  const main = $('#main-content')
  main.innerHTML = `
    <div class="search-page">
      <div class="feed-header">
        <h2>🔍 ユーザー検索</h2>
      </div>
      <div class="post-form" style="margin-bottom:1.5rem;">
        <input type="text" id="search-input" placeholder="ユーザー名を検索..." autofocus style="width:100%;background:transparent;border:none;color:var(--text);font-family:inherit;font-size:1rem;outline:none;padding:0.5rem 0;" />
      </div>
      <div id="search-results"></div>
    </div>`

  const input = $('#search-input')
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce)
    const q = input.value.trim()
    if (q.length < 2) {
      $('#search-results').innerHTML = ''
      return
    }
    searchDebounce = setTimeout(() => doSearch(q), 300)
  })
}

async function doSearch(query) {
  const results = $('#search-results')
  if (!results) return
  results.innerHTML = `<div class="skeleton skeleton-card"></div>`

  try {
    const users = await api(`/users/search/${encodeURIComponent(query)}`, { token: state.token })
    if (!users.length) {
      results.innerHTML = `<div class="empty-feed"><p>🔍 該当するユーザーが見つかりません</p></div>`
      return
    }
    results.innerHTML = users.map(u => `
      <div class="post-card search-result-card" data-username="${escapeHtml(u.username)}" style="cursor:pointer;">
        <div class="post-header">
          <span class="post-author">@${escapeHtml(u.username)}</span>
        </div>
        ${u.displayName ? `<div style="color:var(--text2);font-size:0.85rem;">${escapeHtml(u.displayName)}</div>` : ''}
      </div>`).join('')
    $$('.search-result-card').forEach(card => {
      card.addEventListener('click', () => navigate(`/profile/${card.dataset.username}`))
    })
  } catch (e) {
    results.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`
  }
}

// =============================================================================
// PAGE: DMs
// =============================================================================
async function renderDms() {
  const main = $('#main-content')
  main.innerHTML = `
    <div class="dms-page">
      <div class="feed-header">
        <h2>💬 ダイレクトメッセージ</h2>
      </div>
      <div id="dm-list">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
      </div>
    </div>`

  try {
    const dms = await api('/dms?limit=50', { token: state.token })
    renderDmList(dms)
    // Mark unread as read
    dms.filter(d => !d.isRead && d.from.id !== state.user.id).forEach(d => {
      api(`/dms/${d.id}/read`, { method: 'PUT', token: state.token }).catch(() => {})
    })
    state.unreadDms = 0
    updateDmBadge()
  } catch (e) {
    $('#dm-list').innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`
  }
}

function renderDmList(dms) {
  const list = $('#dm-list')
  if (!list) return

  if (!dms.length) {
    list.innerHTML = `<div class="empty-feed"><div class="empty-icon">📭</div><p>まだDMがありません</p></div>`
    return
  }

  // Group by conversation partner
  const conversations = new Map()
  dms.forEach(dm => {
    const partnerId = dm.from.id === state.user.id ? dm.to.id : dm.from.id
    const partner = dm.from.id === state.user.id ? dm.to : dm.from
    if (!conversations.has(partnerId)) {
      conversations.set(partnerId, { partner, latest: dm, unread: 0 })
    }
    const conv = conversations.get(partnerId)
    if (!dm.isRead && dm.from.id !== state.user.id) conv.unread++
    if (new Date(dm.createdAt) > new Date(conv.latest.createdAt)) conv.latest = dm
  })

  list.innerHTML = Array.from(conversations.values())
    .sort((a, b) => new Date(b.latest.createdAt) - new Date(a.latest.createdAt))
    .map(c => `
      <div class="post-card dm-conversation" data-user-id="${c.partner.id}" style="cursor:pointer;">
        <div class="post-header">
          <span class="post-author">@${escapeHtml(c.partner.username)}</span>
          <span class="post-date">${timeAgo(c.latest.createdAt)}</span>
        </div>
        <div class="post-content" style="color:var(--text2);font-size:0.9rem;">
          ${escapeHtml(c.latest.content).slice(0, 100)}${c.latest.content.length > 100 ? '...' : ''}
        </div>
        ${c.unread > 0 ? `<span class="nav-badge" style="display:inline;margin-top:0.5rem;">${c.unread}</span>` : ''}
      </div>`).join('')

  $$('.dm-conversation').forEach(card => {
    card.addEventListener('click', () => openDmChat(card.dataset.userId))
  })
}

async function openDmChat(userId) {
  const main = $('#main-content')

  // Fetch all DMs and filter
  let allDms
  try {
    allDms = await api('/dms?limit=100', { token: state.token })
  } catch (e) {
    main.innerHTML = `<div class="error-page"><div class="error-card"><p>⚠️ ${escapeHtml(e.message)}</p><button class="btn-secondary" onclick="history.back()">戻る</button></div></div>`
    return
  }

  const myDms = allDms.filter(d =>
    (d.from.id === state.user.id && d.to.id === userId) ||
    (d.from.id === userId && d.to.id === state.user.id)
  ).reverse()

  const partnerName = myDms[0]?.from.id === userId ? myDms[0].from.username : myDms[0]?.to.username || 'unknown'

  main.innerHTML = `
    <div class="dms-page">
      <div class="feed-header">
        <button class="btn-secondary" id="dm-back" style="padding:0.4rem 0.8rem;font-size:0.8rem;">← 戻る</button>
        <h2>💬 @${escapeHtml(partnerName)}</h2>
      </div>
      <div id="dm-messages" style="display:flex;flex-direction:column;gap:0.6rem;margin-bottom:1rem;max-height:60vh;overflow-y:auto;">
        ${myDms.map(d => `
          <div class="post-card ${d.from.id === state.user.id ? 'dm-sent' : 'dm-received'}" style="max-width:80%;${d.from.id === state.user.id ? 'margin-left:auto;' : ''}">
            <div class="post-content" style="font-size:0.9rem;">${escapeHtml(d.content)}</div>
            <div class="post-date" style="font-size:0.65rem;text-align:right;margin-top:0.3rem;">${timeAgo(d.createdAt)}</div>
          </div>`).join('')}
      </div>
      <div class="post-form">
        <textarea id="dm-input" placeholder="メッセージを送信..." rows="2" maxlength="5000"></textarea>
        <div class="post-form-footer">
          <span class="char-count" id="dm-char-count">0 / 5000</span>
          <button id="dm-send-btn" class="btn-primary">送信</button>
        </div>
      </div>
    </div>`

  $('#dm-back').addEventListener('click', () => navigate('/dms'))

  const input = $('#dm-input')
  const charCount = $('#dm-char-count')
  input.addEventListener('input', () => {
    const len = input.value.length
    charCount.textContent = `${len} / 5000`
    charCount.className = 'char-count' + (len > 4900 ? ' warn' : '')
  })

  const sendBtn = $('#dm-send-btn')
  sendBtn.addEventListener('click', async () => {
    const content = input.value.trim()
    if (!content) return

    sendBtn.disabled = true
    sendBtn.textContent = '送信中...'

    try {
      const secretKey = getSecretKey(state.user.username)
      if (!secretKey) throw new Error('秘密鍵が見つかりません')

      const sigBytes = ed.sign(new TextEncoder().encode(content), decodeHex(secretKey))
      const signature = encodeHex(sigBytes)

      await api(`/dms/${userId}`, { method: 'POST', body: { content, signature }, token: state.token })

      // Add message to UI immediately
      const msgContainer = $('#dm-messages')
      const msgEl = document.createElement('div')
      msgEl.className = 'post-card dm-sent'
      msgEl.style.cssText = 'max-width:80%;margin-left:auto;'
      msgEl.innerHTML = `
        <div class="post-content" style="font-size:0.9rem;">${escapeHtml(content)}</div>
        <div class="post-date" style="font-size:0.65rem;text-align:right;margin-top:0.3rem;">たった今</div>`
      msgContainer.appendChild(msgEl)
      msgContainer.scrollTop = msgContainer.scrollHeight

      input.value = ''
      charCount.textContent = '0 / 5000'
      showToast('DM送信しました', 'success')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      sendBtn.disabled = false
      sendBtn.textContent = '送信'
    }
  })

  // Auto-scroll
  const msgContainer = $('#dm-messages')
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight
}

// =============================================================================
// PAGE: Settings
// =============================================================================
function renderSettings() {
  const main = $('#main-content')
  const u = state.user
  main.innerHTML = `
    <div class="settings-page">
      <div class="feed-header">
        <h2>⚙️ 設定</h2>
      </div>
      <div class="auth-card" style="max-width:100%;">
        <form id="settings-form" class="auth-form">
          <div class="form-group">
            <label>表示名</label>
            <input type="text" id="set-displayname" value="${escapeHtml(u.displayName || '')}" placeholder="表示名（任意）" maxlength="64" />
          </div>
          <div class="form-group">
            <label>自己紹介</label>
            <textarea id="set-bio" rows="3" placeholder="自己紹介（任意）" maxlength="500" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.75rem 1rem;color:var(--text);font-family:inherit;font-size:1rem;resize:vertical;outline:none;">${escapeHtml(u.bio || '')}</textarea>
          </div>
          <div class="form-group">
            <label>アバターURL</label>
            <input type="url" id="set-avatar" value="${escapeHtml(u.avatarUrl || '')}" placeholder="https://example.com/avatar.png" />
          </div>
          <div id="settings-error" class="error-msg" style="display:none;"></div>
          <div id="settings-success" class="info-msg" style="display:none;"></div>
          <button type="submit" id="settings-btn" class="btn-primary">保存</button>
        </form>
      </div>
      <div class="auth-card" style="max-width:100%;margin-top:1rem;">
        <h3 style="color:var(--text2);font-size:0.9rem;margin-bottom:0.8rem;">🔑 秘密鍵</h3>
        <p style="font-size:0.8rem;color:var(--text3);margin-bottom:0.5rem;">ユーザー名: <code>${escapeHtml(u.username)}</code></p>
        <button id="btn-export-key" class="btn-secondary" style="font-size:0.8rem;">秘密鍵をエクスポート</button>
      </div>
    </div>`

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = $('#settings-btn')
    const errorEl = $('#settings-error')
    const successEl = $('#settings-success')

    btn.disabled = true
    btn.textContent = '保存中...'
    errorEl.style.display = 'none'
    successEl.style.display = 'none'

    try {
      const body = {}
      const displayName = $('#set-displayname').value.trim()
      const bio = $('#set-bio').value.trim()
      const avatarUrl = $('#set-avatar').value.trim()

      if (displayName) body.displayName = displayName
      else body.displayName = ''
      if (bio) body.bio = bio
      else body.bio = ''
      if (avatarUrl) body.avatarUrl = avatarUrl
      else body.avatarUrl = ''

      const updated = await api('/users/me', { method: 'PUT', body, token: state.token })
      // Update local state
      Object.assign(state.user, {
        displayName: updated.displayName,
        bio: updated.bio,
        avatarUrl: updated.avatarUrl,
      })
      setUser(state.user)
      updateSidebar()
      successEl.textContent = '✅ 保存しました'
      successEl.style.display = 'block'
      showToast('プロフィールを更新しました', 'success')
    } catch (e) {
      errorEl.textContent = e.message
      errorEl.style.display = 'block'
    } finally {
      btn.disabled = false
      btn.textContent = '保存'
    }
  })

  $('#btn-export-key').addEventListener('click', () => {
    const sk = getSecretKey(state.user.username)
    if (!sk) {
      showToast('秘密鍵が見つかりません', 'error')
      return
    }
    navigator.clipboard.writeText(sk).then(() => {
      showToast('秘密鍵をコピーしました', 'success')
    }).catch(() => {
      // Fallback
      prompt('秘密鍵をコピーしてください:', sk)
    })
  })
}

// ── Unread DM Polling ────────────────────────────────────────────────────────
let dmPollTimer = null

function pollUnreadDms() {
  if (dmPollTimer) clearInterval(dmPollTimer)
  dmPollTimer = setInterval(async () => {
    if (!state.token || document.visibilityState !== 'visible') return
    try {
      const { count } = await api('/dms/unread/count', { token: state.token })
      state.unreadDms = count
      updateDmBadge()
    } catch {}
  }, 10000)
}

// ── Initialization ───────────────────────────────────────────────────────────
async function init() {
  const savedUser = getUser()
  const savedToken = getToken()
  const savedSecret = savedUser ? getSecretKey(savedUser.username) : null

  if (savedUser && savedToken && savedSecret) {
    try {
      const result = await api('/auth/verify', { token: savedToken })
      if (result.valid && result.user) {
        updateAuth(result.user, savedToken)
      } else {
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
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-nav]')
  if (link) {
    e.preventDefault()
    const href = link.getAttribute('href')
    if (href) navigate(href.slice(1))
  }
})

window.addEventListener('popstate', render)

document.addEventListener('click', (e) => {
  if (e.target.id === 'btn-logout') {
    updateAuth(null, null)
    api('/auth/logout', { method: 'POST' }).catch(() => {})
    navigate('/')
    showToast('ログアウトしました', 'info')
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user && getRoute().page === 'feed') {
    loadFeed()
  }
})

// ── Start ────────────────────────────────────────────────────────────────────
init()
