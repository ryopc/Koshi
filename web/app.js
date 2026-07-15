/* ====================================================================
 * koshi board — Web Client (Limited Version)
 * Terminal-Inspired Dark Theme
 * ====================================================================
 * Features:
 *   - Feed viewing (public)
 *   - Post creation (authenticated users)
 *   - Login/Register (ed25519 based)
 *   - Minimal profile viewing
 *
 * Excluded (CLI only):
 *   - DM system
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

// ── Helpers ───────────────────────────────────────────────────────────
const $ = (s, c = document) => c.querySelector(s)
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
const S = { user: null, token: null, ready: false, feed: [] }

// ── Auth ──────────────────────────────────────────────────────────────
function login(user, token) {
  S.user = user
  S.token = token
  if (user && token) {
    setUser(user)
    setToken(token)
  } else {
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

// ── Routing ───────────────────────────────────────────────────────────
function route() {
  const h = location.hash.slice(1) || '/'
  const p = h.split('/').filter(Boolean)
  return { path: h, parts: p, page: p[0] || 'feed' }
}

function nav(href) {
  history.pushState(null, '', `#${href}`)
  render()
}

// ── Render ────────────────────────────────────────────────────────────
function render() {
  if (!S.ready) return

  if (!S.user) {
    route().page === 'register' ? pRegister() : pLogin()
    return
  }

  const r = route()
  const pages = {
    feed: pFeed,
    post: pPostDetail,
    profile: pProfile
  }
  ;(pages[r.page] || pFeed)(r.parts[1])
}

// ── Post Card ─────────────────────────────────────────────────────────
function makePost(p) {
  const d = document.createElement('div')
  d.className = 'post'
  d.dataset.id = p.id

  const authorName = p.author?.displayName || p.author?.username || 'unknown'

  d.innerHTML = `
    <div class="post-header">
      <span class="post-author" data-username="${esc(p.author?.username || '')}">@${esc(p.author?.username || '')}</span>
      <span class="post-time">${ago(p.createdAt)}</span>
    </div>
    <div class="post-content">${esc(p.content)}</div>
    <div class="post-footer">
      <span class="post-signature">✓ signed</span>
      ${p.signature ? `<span style="color:var(--text3)">sig:${p.signature.slice(0, 8)}...</span>` : ''}
    </div>
  `

  // Click on author to view profile
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
      <div class="cli-promo-hint">DM・フォロー・検索など全機能が使えます</div>
    </div>
  `

  // Post form events
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
    await api('/posts', { method: 'POST', body: { content, signature: sig } })
    inp.value = ''
    $('#char-c').textContent = '0 / 2000'
    toast('投稿しました', 'success')
    setTimeout(loadFeed, 300)
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
    
    // Fetch posts separately with error handling
    let posts = []
    try {
      const allPosts = await api('/posts/feed?limit=100')
      posts = allPosts.filter(p => p.author?.username === username)
    } catch (postsErr) {
      // Posts fetch failed, but profile loaded OK - show profile without posts
      console.warn('Failed to fetch posts:', postsErr)
    }

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

      <div class="cli-promo" style="margin-top:1rem;margin-bottom:1rem">
        <div class="cli-promo-title">フォローするにはCLIを使用してください</div>
        <div class="cli-promo-code">$ kb follow ${esc(username)}</div>
      </div>

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

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  const su = getUser()
  const st = getToken()
  const ss = su ? getSK(su.username) : null

  if (su && st && ss) {
    try {
      // Try re-login with stored secret key
      const sig = hex(ed.sign(enc.encode(`koshi:login:${su.username}`), dehex(ss)))
      const { token } = await api('/auth/login', {
        method: 'POST',
        body: { username: su.username, signature: sig }
      })
      const profile = await api(`/users/${su.username}`, { token })
      login(profile, token)
    } catch {
      // Re-login failed, clear and start fresh
      clearAll()
    }
  }

  S.ready = true
  $('#loading-screen').style.display = 'none'
  $('#app').style.display = 'flex'
  updateAuthUI()
  render()
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
