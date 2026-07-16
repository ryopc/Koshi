/* ====================================================================
 * koshi board — Web Client
 * Terminal-Inspired Dark Theme
 * ====================================================================
 * Features:
 *   - Feed viewing (public)
 *   - Post creation (authenticated users)
 *   - Login/Register (ed25519 based)
 *   - Profile viewing
 *   - DM system (inbox + real-time chat)
 *   - PWA support
 *
 * Excluded (CLI only):
 *   - Follow/Unfollow
 *   - User search
 *   - Profile editing
 *   - Settings
 * ==================================================================== */

import * as ed from 'https://esm.sh/@noble/ed25519@2.1.0'
import { sha512 } from 'https://esm.sh/@noble/hashes@1.5.0/sha512.js'

// Configure ed25519 for browser
ed.etc.sha512Sync = (...m) => {
  const total = m.reduce((s, a) => s + a.length, 0)
  const merged = new Uint8Array(total)
  let o = 0
  for (const a of m) { merged.set(a, o); o += a.length }
  return sha512(merged)
}

// ── Config ────────────────────────────────────────────────────────────
const API = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://koshi-api.ryopc.f5.si'

const WS_URL = API.replace(/^http/, 'ws') + '/ws'

// ── Helpers ───────────────────────────────────────────────────────────
const $ = (s, c = document) => c.querySelector(s)
const $$ = (s, c = document) => [...c.querySelectorAll(s)]
const enc = new TextEncoder()
const hex = b => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
const dehex = h => {
  const b = new Uint8Array(h.length / 2)
  for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.slice(i, i + 2), 16)
  return b
}
const esc = s => {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}
const ago = iso => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'たった今'
  if (s < 3600) return `${Math.floor(s / 60)}分前`
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`
  return `${Math.floor(s / 86400)}日前`
}
const timeShort = iso => {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  if (isToday) return `${h}:${m}`
  const mon = d.getMonth() + 1
  const day = d.getDate()
  return `${mon}/${day} ${h}:${m}`
}

// ── Toast ─────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = $('#toast-container')
  const t = document.createElement('div')
  t.className = `toast ${type}`
  t.textContent = msg
  c.appendChild(t)
  setTimeout(() => {
    t.classList.add('out')
    setTimeout(() => t.remove(), 300)
  }, 2800)
}

// ── API ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const { token, body, method = 'GET' } = opts
  const headers = { 'Content-Type': 'application/json' }
  const t = token || getToken()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
  return data
}

// ── Storage ───────────────────────────────────────────────────────────
const LS = { T: 'k:tk', U: 'k:u', SK: u => `k:sk:${u}` }
const getToken = () => localStorage.getItem(LS.T)
const setToken = t => localStorage.setItem(LS.T, t)
const getUser = () => { try { return JSON.parse(localStorage.getItem(LS.U)) } catch { return null } }
const setUser = u => localStorage.setItem(LS.U, JSON.stringify(u))
const getSK = u => localStorage.getItem(LS.SK(u))
const setSK = (u, k) => localStorage.setItem(LS.SK(u), k)
const clearAll = () => {
  const u = getUser()
  if (u) localStorage.removeItem(LS.SK(u))
  localStorage.removeItem(LS.T)
  localStorage.removeItem(LS.U)
}

// ── State ─────────────────────────────────────────────────────────────
const S = { user: null, token: null, ready: false, feed: [], ws: null, dmTarget: null }

// ── WebSocket ─────────────────────────────────────────────────────────
let wsReconnectTimer = null
let wsConnected = false

function connectWS() {
  if (!S.token || S.ws) return

  try {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(S.token)}`)

    ws.onopen = () => {
      wsConnected = true
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handleWSMessage(msg)
      } catch {}
    }

    ws.onclose = () => {
      wsConnected = false
      S.ws = null
      updateStatusUI()
      if (S.token) {
        wsReconnectTimer = setTimeout(connectWS, 3000)
      }
    }

    ws.onerror = () => {
      wsConnected = false
    }

    S.ws = ws
    updateStatusUI()
  } catch {}
}

function disconnectWS() {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer)
  if (S.ws) {
    try { S.ws.close() } catch {}
    S.ws = null
  }
  wsConnected = false
  updateStatusUI()
}

function wsSend(type, payload) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify({ type, payload }))
  }
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'dm_received':
      handleNewDM(msg.payload)
      break
    case 'post_created':
      handleNewPost(msg.payload)
      break
    case 'pong':
      break
  }
}

function handleNewPost(post) {
  if (route().page === 'feed' || route().page === '') {
    const list = $('#feed-list')
    if (list && post.author?.username !== S.user?.username) {
      const el = makePost(post)
      el.style.animation = 'slideIn 0.3s ease-out'
      list.prepend(el)
      const count = $('#feed-count')
      if (count) {
        S.feed.unshift(post)
        count.textContent = `${S.feed.length} posts`
      }
      toast(`${post.author?.username || 'someone'}: ${post.content.slice(0, 30)}...`, 'info')
    }
  }
}

function handleNewDM(dm) {
  updateDMBadge(1)

  if (S.dmTarget && route().page === 'dm-chat') {
    const senderUsername = dm.from?.username
    if (senderUsername === S.dmTarget) {
      appendDMMessage(dm, 'received')
      scrollDMToBottom()
      return
    }
  }

  toast(`💬 ${dm.from?.username || 'someone'}からメッセージ`, 'info')
}

function updateDMBadge(increment = 0) {
  const badge = $('#dm-badge')
  if (!badge) return
  let count = parseInt(badge.textContent) || 0
  count = Math.max(0, count + increment)
  badge.textContent = count
  badge.style.display = count > 0 ? '' : 'none'
}

async function loadUnreadCount() {
  if (!S.user) return
  try {
    const { count } = await api('/dms/unread/count')
    const badge = $('#dm-badge')
    if (badge) {
      badge.textContent = count
      badge.style.display = count > 0 ? '' : 'none'
    }
  } catch {}
}

// ── Auth ──────────────────────────────────────────────────────────────
function login(user, token) {
  S.user = user
  S.token = token
  if (user && token) {
    setUser(user)
    setToken(token)
    connectWS()
    loadUnreadCount()
  } else {
    disconnectWS()
    clearAll()
  }
  updateAuthUI()
}

function updateAuthUI() {
  const area = $('#auth-area')
  const status = $('#status-text')

  if (S.user) {
    area.innerHTML = `
      <span style="color:var(--text2);font-size:0.8rem">@${esc(S.user.username)}</span>
      <button class="btn-logout" id="btn-logout">[ログアウト]</button>
    `
    status.classList.remove('offline')
    status.style.color = 'var(--green)'
    $('#btn-logout').onclick = () => {
      login(null, null)
      nav('/')
      toast('ログアウトしました', 'info')
    }
  } else {
    area.innerHTML = '<a href="#/login" class="btn-link" data-nav>[ログイン]</a>'
    status.classList.add('offline')
    status.style.color = 'var(--red)'
  }
}

function updateStatusUI() {
  const status = $('#status-text')
  if (!status) return
  if (wsConnected) {
    status.style.color = 'var(--green)'
    status.title = 'WebSocket接続中'
  } else if (S.user) {
    status.style.color = 'var(--yellow)'
    status.title = '再接続中...'
  }
}

// ── Routing ───────────────────────────────────────────────────────────
function route() {
  const h = location.hash.slice(1) || '/'
  const p = h.split('/').filter(Boolean)
  return { path: h, parts: p, page: p[0] || 'feed' }
}

function nav(href) {
  S.dmTarget = null
  history.pushState(null, '', `#${href}`)
  render()
}

// ── Render ────────────────────────────────────────────────────────────
function render() {
  if (!S.ready) return

  updateMobileNav()

  if (!S.user) {
    const r = route()
    if (r.page === 'register') pRegister()
    else pLogin()
    return
  }

  const r = route()
  const pages = {
    feed: pFeed,
    post: pPostDetail,
    profile: pProfile,
    dm: pDMInbox,
    'dm-chat': pDMChat
  }

  if (r.page === 'dm' && r.parts[1]) {
    S.dmTarget = r.parts[1]
    pDMChat(r.parts[1])
    return
  }

  if (r.page === 'profile' && r.parts[1]) {
    pProfile(r.parts[1])
    return
  }

  if (r.page === 'profile' && !r.parts[1] && S.user) {
    pProfile(S.user.username)
    return
  }

  ;(pages[r.page] || pFeed)()
}

function updateMobileNav() {
  const r = route()
  $$('.bottom-nav-item').forEach(el => {
    const page = el.dataset.page
    el.classList.toggle('active',
      page === r.page ||
      (page === 'feed' && (r.page === 'feed' || r.page === '' || r.page === 'post')) ||
      (page === 'dm' && (r.page === 'dm' || r.page === 'dm-chat')) ||
      (page === 'profile' && r.page === 'profile')
    )
  })
}

// ── Post Card ─────────────────────────────────────────────────────────
function makePost(p) {
  const d = document.createElement('div')
  d.className = 'post'
  d.dataset.id = p.id

  d.innerHTML = `
    <div class="post-header">
      <span class="post-author" data-username="${esc(p.author?.username || '')}">@${esc(p.author?.username || '')}</span>
      <span class="post-time">${ago(p.createdAt || p.timestamp)}</span>
    </div>
    <div class="post-content">${esc(p.content)}</div>
    <div class="post-footer">
      <span class="post-signature">✓ signed</span>
      ${p.signature ? `<span style="color:var(--text3)">sig:${p.signature.slice(0, 8)}...</span>` : ''}
    </div>
  `

  const authorEl = d.querySelector('.post-author')
  if (authorEl) {
    authorEl.onclick = (e) => {
      e.stopPropagation()
      nav(`/profile/${p.author?.username}`)
    }
  }

  return d
}

// ── PAGE: Login ───────────────────────────────────────────────────────
function pLogin() {
  const m = $('#main-content')
  m.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-title">🌊 koshi login</div>
        <div class="auth-sub">ターミナルネイティブな分散SNS</div>
        <form class="form" id="f-login">
          <div class="field">
            <label>username:</label>
            <input id="i-user" placeholder="your-username" required autofocus />
            <small>登録済みのユーザー名を入力してください</small>
          </div>
          <div class="error" id="e-login" style="display:none"></div>
          <button type="submit" class="btn btn-primary" id="b-login" style="width:100%">login</button>
        </form>
        <p class="auth-link">アカウントをお持ちでない方は <a href="#/register" data-nav>新規登録</a></p>
        <div class="cli-promo">
          <div class="cli-promo-title">💡 CLIでログインがおすすめ</div>
          <div class="cli-promo-code">$ kb login</div>
          <div class="cli-promo-hint">より安全な認証ができます</div>
        </div>
      </div>
    </div>
  `

  $('#f-login').onsubmit = async e => {
    e.preventDefault()
    const u = $('#i-user').value.trim().toLowerCase()
    const err = $('#e-login')
    const btn = $('#b-login')

    if (!u) {
      err.textContent = 'ユーザー名を入力してください'
      err.style.display = ''
      return
    }

    const sk = getSK(u)
    if (!sk) {
      err.textContent = '秘密鍵が見つかりません。登録してください。'
      err.style.display = ''
      return
    }

    btn.disabled = true
    btn.textContent = '...'

    try {
      const challenge = `koshi:login:${u}`
      const sig = hex(ed.sign(enc.encode(challenge), dehex(sk)))
      const { token } = await api('/auth/login', {
        method: 'POST',
        body: { username: u, signature: sig }
      })
      const profile = await api(`/users/${u}`, { token })
      login(profile, token)
      nav('/')
      toast('ログインしました', 'success')
    } catch (e) {
      err.textContent = e.message
      err.style.display = ''
    } finally {
      btn.disabled = false
      btn.textContent = 'login'
    }
  }
}

// ── PAGE: Register ────────────────────────────────────────────────────
function pRegister() {
  const m = $('#main-content')
  m.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-title">🌊 koshi register</div>
        <div class="auth-sub">新規アカウント登録</div>
        <form class="form" id="f-reg">
          <div class="field">
            <label>username:</label>
            <input id="i-reg" placeholder="your-username" required autofocus />
            <small>3〜32文字。英数字、ハイフン、アンダースコア</small>
          </div>
          <div class="error" id="e-reg" style="display:none"></div>
          <div class="auth-secret" id="sec-box" style="display:none"></div>
          <button type="submit" class="btn btn-primary" id="b-reg" style="width:100%">register</button>
        </form>
        <p class="auth-link">すでにアカウントをお持ちの方は <a href="#/login" data-nav>ログイン</a></p>
        <div class="cli-promo">
          <div class="cli-promo-title">💡 CLIで登録がおすすめ</div>
          <div class="cli-promo-code">$ kb register your-username</div>
          <div class="cli-promo-hint">より安全な鍵管理ができます</div>
        </div>
      </div>
    </div>
  `

  $('#f-reg').onsubmit = async e => {
    e.preventDefault()
    const u = $('#i-reg').value.trim().toLowerCase()
    const err = $('#e-reg')
    const sec = $('#sec-box')
    const btn = $('#b-reg')

    if (!u) {
      err.textContent = 'ユーザー名を入力してください'
      err.style.display = ''
      return
    }

    if (u.length < 3) {
      err.textContent = 'ユーザー名は3文字以上で入力してください'
      err.style.display = ''
      return
    }

    btn.disabled = true
    btn.textContent = '...'

    try {
      const sk = ed.utils.randomPrivateKey()
      const pk = ed.getPublicKey(sk)
      const { token } = await api('/auth/register', {
        method: 'POST',
        body: { username: u, publicKey: hex(pk) }
      })
      setSK(u, hex(sk))
      const profile = await api(`/users/${u}`, { token })
      login(profile, token)

      const skHex = hex(sk)
      sec.innerHTML = `
        <strong style="color:var(--yellow)">🔑 秘密鍵 (必ず保存!)</strong>
        <div style="margin-top:0.5rem;font-family:var(--mono);font-size:0.75rem;word-break:break-all;background:var(--bg);padding:0.5rem;border-radius:var(--r1);border:1px solid var(--border)">${skHex}</div>
        <button class="btn btn-sm" id="copy-sk" style="margin-top:0.5rem">📋 コピー</button>
      `
      sec.querySelector('#copy-sk').onclick = () => {
        navigator.clipboard.writeText(skHex).then(() => toast('コピーしました', 'success'))
      }
      sec.style.display = ''

      toast('アカウントを作成しました！', 'success')
      setTimeout(() => nav('/'), 1500)
    } catch (e) {
      err.textContent = e.message
      err.style.display = ''
    } finally {
      btn.disabled = false
      btn.textContent = 'register'
    }
  }
}

// ── PAGE: Feed ────────────────────────────────────────────────────────
function pFeed() {
  const m = $('#main-content')

  const postForm = S.user ? `
    <div class="post-form">
      <div class="post-form-header">
        <span class="prompt">$</span>
        <span>koshi post</span>
      </div>
      <textarea id="post-in" placeholder="いまどうしてる？" maxlength="2000" rows="3"></textarea>
      <div class="post-form-footer">
        <span class="char-count" id="char-c">0 / 2000</span>
        <button class="btn btn-primary btn-sm" id="post-btn">投稿する</button>
      </div>
    </div>
    <div class="error" id="post-err" style="display:none"></div>
  ` : `
    <div class="cli-promo">
      <div class="cli-promo-title">投稿するにはログインが必要です</div>
      <div class="cli-promo-code">$ kb post "Hello, koshi!"</div>
      <div class="cli-promo-hint">CLIで投稿してみましょう</div>
    </div>
  `

  m.innerHTML = `
    <div class="feed-header">
      <div class="feed-title">$ cat /var/log/feed</div>
      <span class="feed-count" id="feed-count"></span>
    </div>
    ${postForm}
    <div id="feed-list">
      <div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line" style="width:40%"></div></div>
      <div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line" style="width:40%"></div></div>
    </div>
    <div class="cli-promo">
      <div class="cli-promo-title">🌟 もっと便利にkoshiを使うには</div>
      <div class="cli-promo-code">$ npm install -g @ryopc/koshi</div>
      <div class="cli-promo-hint">フォロー・検索など全機能が使えます</div>
    </div>
  `

  if (S.user) {
    const inp = $('#post-in')
    inp.oninput = () => {
      const l = inp.value.length
      const c = $('#char-c')
      c.textContent = `${l} / 2000`
      c.className = 'char-count' + (l > 1900 ? (l >= 2000 ? ' limit' : ' warn') : '')
    }
    $('#post-btn').onclick = doSubmit
    inp.onkeydown = e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSubmit()
    }
  }

  loadFeed()
}

async function doSubmit() {
  const inp = $('#post-in')
  const btn = $('#post-btn')
  const err = $('#post-err')
  const content = inp.value.trim()

  if (!content || !S.user) return

  btn.disabled = true
  err.style.display = 'none'

  try {
    const sk = getSK(S.user.username)
    if (!sk) throw new Error('秘密鍵が見つかりません')
    const sig = hex(ed.sign(enc.encode(content), dehex(sk)))

    if (S.ws && S.ws.readyState === WebSocket.OPEN) {
      wsSend('post:create', { content, signature: sig })
      inp.value = ''
      $('#char-c').textContent = '0 / 2000'
      toast('投稿しました', 'success')
    } else {
      await api('/posts', { method: 'POST', body: { content, signature: sig } })
      inp.value = ''
      $('#char-c').textContent = '0 / 2000'
      toast('投稿しました', 'success')
      setTimeout(loadFeed, 300)
    }
  } catch (e) {
    err.textContent = e.message
    err.style.display = ''
  } finally {
    btn.disabled = false
    btn.textContent = '投稿する'
  }
}

async function loadFeed() {
  const list = $('#feed-list')
  if (!list) return

  try {
    const posts = await api('/posts/feed?limit=50')
    S.feed = posts

    const countEl = $('#feed-count')
    if (countEl) countEl.textContent = `${posts.length} posts`

    if (posts.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📭</span>
          <span class="empty-text">まだ投稿がありません</span>
        </div>
      `
      return
    }

    list.innerHTML = ''
    posts.forEach(p => list.appendChild(makePost(p)))
  } catch (e) {
    list.innerHTML = `<div class="error">${esc(e.message)}</div>`
  }
}

// ── PAGE: Post Detail ─────────────────────────────────────────────────
async function pPostDetail(postId) {
  const m = $('#main-content')
  m.innerHTML = '<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>'

  try {
    const post = await api(`/posts/${postId}`)
    m.innerHTML = `
      <div class="feed-header">
        <div class="feed-title">$ cat /var/log/feed/${esc(postId)}</div>
        <a href="#/" class="btn-link" data-nav>← 戻る</a>
      </div>
      <div class="post-list" id="post-detail"></div>
    `
    const list = $('#post-detail')
    list.appendChild(makePost(post))
  } catch (e) {
    m.innerHTML = `
      <div class="error-page">
        <div class="error-card">
          <p>${esc(e.message)}</p>
          <a href="#/" class="btn" data-nav>戻る</a>
        </div>
      </div>
    `
  }
}

// ── PAGE: Profile ─────────────────────────────────────────────────────
async function pProfile(username) {
  const m = $('#main-content')
  if (!username) { nav('/'); return }

  m.innerHTML = '<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>'

  try {
    const profile = await api(`/users/${username}`)

    let posts = []
    try {
      const allPosts = await api('/posts/feed?limit=100')
      posts = allPosts.filter(p => p.author?.username === username)
    } catch (postsErr) {
      console.warn('Failed to fetch posts:', postsErr)
    }

    const isOwn = S.user && S.user.username === username

    const dmForm = S.user && !isOwn ? `
      <div class="dm-send-form">
        <div class="dm-send-form-header">💬 ${esc(username)}にメッセージを送る</div>
        <textarea id="dm-quick-input" placeholder="メッセージを入力..." rows="2" maxlength="5000"></textarea>
        <div class="dm-send-form-footer">
          <span class="char-count" id="dm-quick-count">0 / 5000</span>
          <button class="btn btn-primary btn-sm" id="dm-quick-send">送信</button>
        </div>
        <div class="error" id="dm-quick-err" style="display:none;margin-top:0.5rem"></div>
      </div>
    ` : ''

    const dmLink = S.user && !isOwn ? `
      <div class="cli-promo" style="margin-bottom:1rem">
        <div class="cli-promo-title">💬 DMで会話する</div>
        <a href="#/dm/${esc(username)}" class="btn btn-sm" data-nav style="margin-top:0.5rem">DMを開く →</a>
      </div>
    ` : ''

    m.innerHTML = `
      <div class="feed-header">
        <div class="feed-title">$ cat /etc/passwd | grep ${esc(username)}</div>
        <a href="#/" class="btn-link" data-nav>← 戻る</a>
      </div>
      <div class="auth-card" style="margin-bottom:1.5rem">
        <div style="display:flex;gap:1rem;align-items:center">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:var(--green);border:1px solid var(--border)">
            ${profile.avatarUrl ? `<img src="${esc(profile.avatarUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />` : (profile.username[0] || '?').toUpperCase()}
          </div>
          <div>
            <div style="font-size:0.95rem;color:var(--cyan)">@${esc(profile.username)}</div>
            ${profile.displayName ? `<div style="font-size:0.8rem;color:var(--text2)">${esc(profile.displayName)}</div>` : ''}
          </div>
        </div>
        ${profile.bio ? `<div style="margin-top:0.75rem;font-size:0.85rem;color:var(--text2);padding-top:0.75rem;border-top:1px solid var(--border)">${esc(profile.bio)}</div>` : ''}
        <div style="margin-top:0.75rem;font-size:0.75rem;color:var(--text3)">
          <span>フォロワー: ${profile.followersCount ?? 0}</span>
          <span style="margin:0 0.5rem">|</span>
          <span>フォロー中: ${profile.followingCount ?? 0}</span>
        </div>
      </div>

      ${isOwn ? `
        <div class="cli-promo" style="margin-bottom:1rem">
          <div class="cli-promo-title">プロフィール編集はCLIを使用してください</div>
          <div class="cli-promo-code">$ kb profile edit</div>
        </div>
      ` : `
        <div class="cli-promo" style="margin-bottom:1rem">
          <div class="cli-promo-title">フォローするにはCLIを使用してください</div>
          <div class="cli-promo-code">$ kb follow ${esc(username)}</div>
        </div>
      `}

      ${dmLink}
      ${dmForm}

      <div style="font-size:0.85rem;color:var(--text2);margin-bottom:0.75rem">📝 投稿一覧 (${posts.length})</div>
      <div id="profile-posts" class="post-list"></div>
    `

    const list = $('#profile-posts')
    if (posts.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📭</span>
          <span class="empty-text">まだ投稿がありません</span>
        </div>
      `
    } else {
      posts.forEach(p => list.appendChild(makePost(p)))
    }

    if (S.user && !isOwn) {
      const dmInp = $('#dm-quick-input')
      if (dmInp) {
        dmInp.oninput = () => {
          const l = dmInp.value.length
          const c = $('#dm-quick-count')
          if (c) c.textContent = `${l} / 5000`
        }
        $('#dm-quick-send').onclick = async () => {
          const content = dmInp.value.trim()
          const errEl = $('#dm-quick-err')
          const btn = $('#dm-quick-send')
          if (!content) return

          btn.disabled = true
          errEl.style.display = 'none'

          try {
            const sk = getSK(S.user.username)
            if (!sk) throw new Error('秘密鍵が見つかりません')
            const sig = hex(ed.sign(enc.encode(content), dehex(sk)))

            const recipient = await api(`/users/${username}`)
            await api(`/dms/${recipient.id}`, {
              method: 'POST',
              body: { content, signature: sig }
            })
            dmInp.value = ''
            $('#dm-quick-count').textContent = '0 / 5000'
            toast(`@${username}にメッセージを送信しました`, 'success')
          } catch (e) {
            errEl.textContent = e.message
            errEl.style.display = ''
          } finally {
            btn.disabled = false
          }
        }
      }
    }
  } catch (e) {
    m.innerHTML = `
      <div class="error-page">
        <div class="error-card">
          <p>${esc(e.message)}</p>
          <a href="#/" class="btn" data-nav>戻る</a>
        </div>
      </div>
    `
  }
}

// ── PAGE: DM Inbox ────────────────────────────────────────────────────
async function pDMInbox() {
  const m = $('#main-content')

  m.innerHTML = `
    <div class="dm-inbox">
      <div class="dm-inbox-header">
        <div class="dm-inbox-title">💬 ダイレクトメッセージ</div>
      </div>
      <div id="dm-inbox-list">
        <div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
        <div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
      </div>
    </div>
  `

  try {
    const dms = await api('/dms?limit=100')
    const inboxList = $('#dm-inbox-list')
    if (!inboxList) return

    const conversations = new Map()
    for (const dm of dms) {
      const partner = dm.from.username === S.user.username ? dm.to : dm.from
      if (!conversations.has(partner.username)) {
        conversations.set(partner.username, {
          partner,
          lastMessage: dm,
          unread: !dm.isRead && dm.to.username === S.user.username
        })
      }
    }

    if (conversations.size === 0) {
      inboxList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📭</span>
          <span class="empty-text">まだメッセージがありません</span>
        </div>
        <div class="cli-promo" style="margin-top:1rem">
          <div class="cli-promo-title">ユーザーのプロフィールからDMを始めましょう</div>
        </div>
      `
      return
    }

    inboxList.innerHTML = ''
    for (const [username, conv] of conversations) {
      const el = document.createElement('a')
      el.className = 'dm-thread'
      el.href = `#/dm/${username}`
      el.dataset.nav = ''
      el.innerHTML = `
        <div class="dm-thread-avatar">${(username[0] || '?').toUpperCase()}</div>
        <div class="dm-thread-info">
          <div class="dm-thread-name">@${esc(username)}</div>
          <div class="dm-thread-preview">${esc(conv.lastMessage.content.slice(0, 60))}</div>
        </div>
        <div class="dm-thread-meta">
          <span class="dm-thread-time">${ago(conv.lastMessage.createdAt)}</span>
          ${conv.unread ? '<span class="dm-thread-unread"></span>' : ''}
        </div>
      `
      inboxList.appendChild(el)
    }
  } catch (e) {
    const inboxList = $('#dm-inbox-list')
    if (inboxList) inboxList.innerHTML = `<div class="error">${esc(e.message)}</div>`
  }
}

// ── PAGE: DM Chat ─────────────────────────────────────────────────────
async function pDMChat(username) {
  const m = $('#main-content')
  S.dmTarget = username

  m.innerHTML = `
    <div class="dm-chat">
      <div class="dm-chat-header">
        <a class="dm-chat-back" data-nav href="#/dm">←</a>
        <span class="dm-chat-user">@${esc(username)}</span>
      </div>
      <div class="dm-messages" id="dm-messages">
        <div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
      </div>
      <div class="dm-input-area">
        <textarea id="dm-input" placeholder="メッセージを入力..." rows="1" maxlength="5000"></textarea>
        <button class="dm-send-btn" id="dm-send" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </div>
  `

  let recipient
  try {
    recipient = await api(`/users/${username}`)
  } catch (e) {
    m.innerHTML = `
      <div class="error-page">
        <div class="error-card">
          <p>ユーザーが見つかりません: ${esc(username)}</p>
          <a href="#/dm" class="btn" data-nav>DM一覧に戻る</a>
        </div>
      </div>
    `
    return
  }

  try {
    const dms = await api('/dms?limit=100')
    const conversation = dms.filter(dm =>
      (dm.from.username === username && dm.to.username === S.user.username) ||
      (dm.from.username === S.user.username && dm.to.username === username)
    ).reverse()

    const messagesEl = $('#dm-messages')
    messagesEl.innerHTML = ''

    if (conversation.length === 0) {
      messagesEl.innerHTML = `
        <div class="empty-state" style="flex:1;display:flex;align-items:center;justify-content:center">
          <div>
            <span class="empty-icon">💬</span>
            <span class="empty-text">@${esc(username)}にメッセージを送りましょう</span>
          </div>
        </div>
      `
    } else {
      for (const dm of conversation) {
        if (!dm.isRead && dm.to.username === S.user.username) {
          api(`/dms/${dm.id}/read`, { method: 'PUT' }).catch(() => {})
        }
        const isMine = dm.from.username === S.user.username
        appendDMMessage(dm, isMine ? 'sent' : 'received')
      }
      scrollDMToBottom(false)
    }

    loadUnreadCount()
  } catch (e) {
    const messagesEl = $('#dm-messages')
    messagesEl.innerHTML = `<div class="error">${esc(e.message)}</div>`
  }

  const inp = $('#dm-input')
  const sendBtn = $('#dm-send')

  inp.oninput = () => {
    sendBtn.disabled = !inp.value.trim()
    inp.style.height = 'auto'
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'
  }

  inp.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (inp.value.trim()) sendDM(username, recipient.id)
    }
  }

  sendBtn.onclick = () => {
    if (inp.value.trim()) sendDM(username, recipient.id)
  }
}

function appendDMMessage(dm, type) {
  const messagesEl = $('#dm-messages')
  if (!messagesEl) return

  const empty = messagesEl.querySelector('.empty-state')
  if (empty) empty.remove()

  const el = document.createElement('div')
  el.className = `dm-msg ${type}`
  el.innerHTML = `
    <div>${esc(dm.content)}</div>
    <div class="dm-msg-time">${timeShort(dm.createdAt || dm.timestamp)}</div>
  `
  messagesEl.appendChild(el)
}

function scrollDMToBottom(smooth = true) {
  const messagesEl = $('#dm-messages')
  if (messagesEl) {
    setTimeout(() => {
      messagesEl.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant'
      })
    }, 50)
  }
}

async function sendDM(username, recipientId) {
  const inp = $('#dm-input')
  const sendBtn = $('#dm-send')
  const content = inp.value.trim()
  if (!content || !S.user) return

  sendBtn.disabled = true
  inp.value = ''
  inp.style.height = 'auto'

  const sk = getSK(S.user.username)
  if (!sk) {
    toast('秘密鍵が見つかりません', 'error')
    return
  }

  const sig = hex(ed.sign(enc.encode(content), dehex(sk)))

  try {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) {
      wsSend('dm:send', { recipientId, content, signature: sig })

      appendDMMessage({
        content,
        signature: sig,
        createdAt: new Date().toISOString(),
        from: { username: S.user.username }
      }, 'sent')
      scrollDMToBottom()
    } else {
      const result = await api(`/dms/${recipientId}`, {
        method: 'POST',
        body: { content, signature: sig }
      })

      appendDMMessage(result, 'sent')
      scrollDMToBottom()
    }
  } catch (e) {
    toast(`送信失敗: ${e.message}`, 'error')
    inp.value = content
  } finally {
    sendBtn.disabled = !inp.value.trim()
  }
}

// ── PWA ───────────────────────────────────────────────────────────────
let deferredPrompt = null

function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e

    const installEl = $('#pwa-install')
    if (installEl) {
      installEl.style.display = ''

      $('#pwa-install-btn').onclick = async () => {
        deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') {
          toast('アプリをインストールしました！', 'success')
        }
        deferredPrompt = null
        installEl.style.display = 'none'
      }

      $('#pwa-dismiss-btn').onclick = () => {
        installEl.style.display = 'none'
        localStorage.setItem('k:pwa-dismiss', '1')
      }

      if (localStorage.getItem('k:pwa-dismiss')) {
        installEl.style.display = 'none'
      }
    }
  })

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  }
}

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  const su = getUser()
  const st = getToken()
  const ss = su ? getSK(su.username) : null

  if (su && st && ss) {
    try {
      const sig = hex(ed.sign(enc.encode(`koshi:login:${su.username}`), dehex(ss)))
      const { token } = await api('/auth/login', {
        method: 'POST',
        body: { username: su.username, signature: sig }
      })
      const profile = await api(`/users/${su.username}`, { token })
      login(profile, token)
    } catch {
      clearAll()
    }
  }

  S.ready = true
  $('#loading-screen').style.display = 'none'
  $('#app').style.display = 'flex'
  updateAuthUI()
  render()
  setupPWA()
}

// ── Events ────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const a = e.target.closest('[data-nav]')
  if (a) {
    e.preventDefault()
    const h = a.getAttribute('href')
    if (h) nav(h.slice(1))
  }
})

window.addEventListener('popstate', render)

document.addEventListener('DOMContentLoaded', init)
