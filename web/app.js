/* ====================================================================
 * koshi — Web Client (Vanilla JS SPA)
 * Light Mode / Complete Rewrite
 * ==================================================================== */

import * as ed from 'https://esm.sh/@noble/ed25519@2.1.0'
import { sha512 } from 'https://esm.sh/@noble/hashes@1.5.0/sha512.js'

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
const WS_BASE = API.replace(/^http/, 'ws')

// ── Helpers ───────────────────────────────────────────────────────────
const $ = (s, c = document) => c.querySelector(s)
const $$ = (s, c = document) => [...c.querySelectorAll(s)]
const enc = new TextEncoder()
const hex = b => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
const dehex = h => { const b = new Uint8Array(h.length / 2); for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.slice(i, i + 2), 16); return b }
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }
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
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300) }, 2800)
}

// ── API ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const { token, body, method = 'GET', ...rest } = opts
  const headers = { 'Content-Type': 'application/json' }
  const t = token || getToken()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const res = await fetch(`${API}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, ...rest })
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
const clearAll = () => { const u = getUser(); if (u) localStorage.removeItem(LS.SK(u)); localStorage.removeItem(LS.T); localStorage.removeItem(LS.U) }

// ── State ─────────────────────────────────────────────────────────────
const S = { user: null, token: null, ready: false, feed: [], unreadDm: 0 }

// ── WebSocket ─────────────────────────────────────────────────────────
let ws = null, wsTimer = null, wsDelay = 1000

function wsConnect() {
  if (ws && ws.readyState < 2) return
  if (!S.token) return
  try { ws = new WebSocket(`${WS_BASE}/ws?token=${S.token}`) } catch { return }
  ws.onopen = () => { wsDelay = 1000 }
  ws.onmessage = e => { try { wsHandle(JSON.parse(e.data)) } catch {} }
  ws.onclose = () => {
    if (S.token) wsTimer = setTimeout(() => { wsDelay = Math.min(wsDelay * 1.5, 30000); wsConnect() }, wsDelay)
  }
}
function wsSend(type, payload) { if (ws?.readyState === 1) ws.send(JSON.stringify({ type, payload })) }
function wsHandle({ type, payload }) {
  if (type === 'post_created' || type === 'post:created') wsOnPost(payload)
  if (type === 'dm_received') { S.unreadDm++; updateBadge() }
}
function wsOnPost(post) {
  if (S.feed.some(p => p.id === post.id)) return
  S.feed.unshift(post)
  if (route().page === 'feed') {
    const list = $('#feed-list')
    if (list) {
      const empty = list.querySelector('.empty'); if (empty) empty.remove()
      list.prepend(makePost(post, true))
      toast(`${post.author.username} が新規投稿`, 'info')
    }
  }
}
function wsDisconnect() { clearTimeout(wsTimer); ws?.close(); ws = null }

// ── Auth ──────────────────────────────────────────────────────────────
function login(user, token) {
  S.user = user; S.token = token
  if (user && token) { setUser(user); setToken(token); wsConnect(); pollDm() }
  else { wsDisconnect(); clearAll() }
  updateNav()
}

// ── Routing ───────────────────────────────────────────────────────────
function route() {
  const h = location.hash.slice(1) || '/'
  const p = h.split('/').filter(Boolean)
  return { path: h, parts: p, page: p[0] || 'feed' }
}
function nav(href) { history.pushState(null, '', `#${href}`); render() }

// ── Nav ───────────────────────────────────────────────────────────────
function updateNav() {
  const el = $('#sidebar-user'), nm = $('#sidebar-username')
  if (S.user) { el.style.display = ''; nm.textContent = `@${S.user.username}` }
  else el.style.display = 'none'
  const r = route()
  $$('.nav-item').forEach(a => {
    const pg = a.dataset.navPage
    if (S.user) a.style.display = ''
    else if (pg !== 'feed') a.style.display = 'none'
    a.classList.toggle('active', pg === r.page || (r.page === 'feed' && pg === 'feed'))
  })
}

function updateBadge() {
  const b = $('#dm-badge')
  if (!b) return
  if (S.unreadDm > 0) { b.textContent = S.unreadDm; b.style.display = '' }
  else b.style.display = 'none'
}

// ── Render ────────────────────────────────────────────────────────────
function render() {
  if (!S.ready) return
  if (!S.user) { route().page === 'register' ? pRegister() : pLogin(); return }
  updateNav()
  const r = route()
  const pages = { feed: pFeed, profile: pProfile, search: pSearch, dms: pDms, settings: pSettings }
  ;(pages[r.page] || pFeed)(r.parts[1])
}

// ── Post Card ─────────────────────────────────────────────────────────
function makePost(p, isNew) {
  const d = document.createElement('div')
  d.className = 'post' + (isNew ? ' is-new' : '')
  d.dataset.id = p.id
  d.innerHTML = `<div class="post-head"><span class="post-author" data-u="${esc(p.author.username)}">@${esc(p.author.username)}</span><span class="post-date">${ago(p.createdAt)}</span></div><div class="post-body">${esc(p.content)}</div><div class="post-foot2"><span class="sig">✓署名済み</span></div>`
  d.querySelector('.post-author').onclick = () => nav(`/profile/${p.author.username}`)
  return d
}

// ── PAGE: Login ───────────────────────────────────────────────────────
function pLogin() {
  const m = $('#main-content')
  m.innerHTML = `<div class="auth"><div class="auth-card"><h1 class="auth-title">🌊 koshi</h1><p class="auth-sub">ターミナルネイティブな分散SNS</p><form class="form" id="f-login"><div class="field"><label>ユーザー名</label><input id="i-user" placeholder="gast-yourname" required autofocus /></div><div class="error" id="e-login" style="display:none"></div><button type="submit" class="btn btn-primary" id="b-login" style="width:100%">ログイン</button></form><p class="auth-link">アカウントをお持ちでない方は <a href="#/register" data-nav>新規登録</a></p><div class="auth-note">💡 秘密鍵は端末に保存されます<br>アカウントは複数端末で共有できません</div></div></div>`
  $('#f-login').onsubmit = async e => {
    e.preventDefault()
    const u = $('#i-user').value.trim().toLowerCase(), err = $('#e-login'), btn = $('#b-login')
    if (!u.startsWith('gast-')) { err.textContent = 'gast- から始めてください'; err.style.display = ''; return }
    const sk = getSK(u)
    if (!sk) { err.textContent = '秘密鍵が見つかりません。登録してください。'; err.style.display = ''; return }
    btn.disabled = true; btn.textContent = '...'
    try {
      const ch = `koshi:login:${u}`, sig = hex(ed.sign(enc.encode(ch), dehex(sk)))
      const { token } = await api('/auth/login', { method: 'POST', body: { username: u, signature: sig } })
      const profile = await api(`/users/${u}`, { token })
      login(profile, token); nav('/')
    } catch (e) { err.textContent = e.message; err.style.display = '' }
    finally { btn.disabled = false; btn.textContent = 'ログイン' }
  }
}

// ── PAGE: Register ────────────────────────────────────────────────────
function pRegister() {
  const m = $('#main-content')
  m.innerHTML = `<div class="auth"><div class="auth-card"><h1 class="auth-title">🌊 koshi</h1><p class="auth-sub">新規アカウント登録</p><form class="form" id="f-reg"><div class="field"><label>ユーザー名</label><input id="i-reg" placeholder="gast-yourname" required autofocus /><small>3〜32文字。gast- から始めてください</small></div><div class="error" id="e-reg" style="display:none"></div><div class="auth-secret" id="sec-box" style="display:none"></div><button type="submit" class="btn btn-primary" id="b-reg" style="width:100%">登録</button></form><p class="auth-link">すでにアカウントをお持ちの方は <a href="#/" data-nav>ログイン</a></p></div></div>`
  $('#f-reg').onsubmit = async e => {
    e.preventDefault()
    const u = $('#i-reg').value.trim().toLowerCase(), err = $('#e-reg'), sec = $('#sec-box'), btn = $('#b-reg')
    if (!u.startsWith('gast-')) { err.textContent = 'gast- から始めてください'; err.style.display = ''; return }
    btn.disabled = true; btn.textContent = '...'
    try {
      const sk = ed.utils.randomPrivateKey(), pk = ed.getPublicKey(sk)
      const { token } = await api('/auth/register', { method: 'POST', body: { username: u, publicKey: hex(pk) } })
      setSK(u, hex(sk))
      const profile = await api(`/users/${u}`, { token })
      login(profile, token)
      const skHex = hex(sk)
      sec.innerHTML = `<strong>🔑 秘密鍵 (必ず保存!)</strong><div style="margin-top:.4rem;font-family:var(--mono);font-size:.65rem;word-break:break-all">${skHex}</div><button class="btn btn-secondary" id="copy-sk" style="margin-top:.4rem;font-size:.72rem;padding:.25rem .6rem">📋 コピー</button>`
      sec.querySelector('#copy-sk').onclick = () => navigator.clipboard.writeText(skHex).then(() => toast('コピーしました', 'success'))
      sec.style.display = ''
      toast('アカウントを作成しました！', 'success')
      setTimeout(() => nav('/'), 1500)
    } catch (e) { err.textContent = e.message; err.style.display = '' }
    finally { btn.disabled = false; btn.textContent = '登録' }
  }
}

// ── PAGE: Feed ────────────────────────────────────────────────────────
function pFeed() {
  const m = $('#main-content')
  m.innerHTML = `<div class="feed-head"><h2>🌊 タイムライン</h2><span class="live">● LIVE</span></div><div class="post-form"><textarea id="post-in" placeholder="いまどうしてる？" maxlength="2000" rows="2"></textarea><div class="post-foot"><span class="char-count" id="char-c">0 / 2000</span><button class="btn btn-primary" id="post-btn">投稿</button></div></div><div class="error" id="post-err" style="display:none"></div><div id="feed-list"><div class="skel skeleton"></div><div class="skel skeleton"></div></div>`
  const inp = $('#post-in')
  inp.oninput = () => { const l = inp.value.length; const c = $('#char-c'); c.textContent = `${l} / 2000`; c.className = 'char-count' + (l > 1900 ? ' warn' : '') }
  $('#post-btn').onclick = doSubmit
  inp.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSubmit() }
  loadFeed()
  if (S.token && (!ws || ws.readyState !== 1)) wsConnect()
}

async function doSubmit() {
  const inp = $('#post-in'), btn = $('#post-btn'), err = $('#post-err')
  const content = inp.value.trim()
  if (!content || !S.user) return
  btn.disabled = true; err.style.display = 'none'
  try {
    const sk = getSK(S.user.username)
    if (!sk) throw new Error('秘密鍵が見つかりません')
    const sig = hex(ed.sign(enc.encode(content), dehex(sk)))
    if (ws?.readyState === 1) wsSend('post:create', { content, signature: sig })
    else await api('/posts', { method: 'POST', body: { content, signature: sig } })
    inp.value = ''; $('#char-c').textContent = '0 / 2000'
    toast('投稿しました', 'success')
    setTimeout(loadFeed, 500)
  } catch (e) { err.textContent = e.message; err.style.display = '' }
  finally { btn.disabled = false; btn.textContent = '投稿' }
}

async function loadFeed() {
  const list = $('#feed-list'); if (!list) return
  try {
    const posts = await api('/posts/feed?limit=50')
    S.feed = posts
    list.innerHTML = posts.length ? '' : '<div class="empty"><span class="empty-icon">🌱</span>まだ投稿がありません</div>'
    posts.forEach(p => list.appendChild(makePost(p)))
  } catch (e) { if (list) list.innerHTML = `<div class="error">${esc(e.message)}</div>` }
}

// ── PAGE: Profile ─────────────────────────────────────────────────────
async function pProfile(username) {
  const m = $('#main-content'), target = username || S.user?.username
  if (!target) { nav('/'); return }
  m.innerHTML = '<div class="loading-page">読み込み中...</div>'
  try {
    const [profile, posts] = await Promise.all([
      api(`/users/${target}`),
      api(`/users/${target}/posts`)
    ])
    const isMe = S.user?.id === profile.id
    const ch = profile.displayName?.[0] || profile.username[0] || '?'
    m.innerHTML = `<div class="profile"><div class="profile-card"><div class="avatar">${profile.avatarUrl ? `<img src="${esc(profile.avatarUrl)}" />` : ch.toUpperCase()}</div><div class="pinfo"><div class="pusername">@${esc(profile.username)}</div>${profile.displayName ? `<div class="pdisplay">${esc(profile.displayName)}</div>` : ''}${profile.bio ? `<div class="pbio">${esc(profile.bio)}</div>` : ''}<div class="pstats"><span><strong>${profile.followersCount ?? 0}</strong> フォロワー</span><span><strong>${profile.followingCount ?? 0}</strong> フォロー中</span></div><div class="pactions">${!isMe ? `<button class="btn btn-follow" id="b-follow">${profile.isFollowing ? 'フォロー解除' : 'フォローする'}</button><button class="btn btn-secondary" id="b-dm">💬 DM</button>` : `<button class="btn btn-secondary" id="b-edit">編集</button>`}</div></div></div><h3 class="ptitle">📝 投稿</h3><div id="profile-posts">${posts.length ? '' : '<div class="empty">まだ投稿がありません</div>'}</div></div>`
    const plist = $('#profile-posts')
    posts.forEach(p => plist.appendChild(makePost(p)))
    if (!isMe) {
      const fb = $('#b-follow')
      fb.onclick = async () => {
        fb.disabled = true
        try {
          if (profile.isFollowing) { await api(`/users/${profile.id}/follow`, { method: 'DELETE' }); profile.isFollowing = false; fb.textContent = 'フォローする'; fb.className = 'btn btn-follow'; toast('フォロー解除', 'info') }
          else { await api(`/users/${profile.id}/follow`, { method: 'POST' }); profile.isFollowing = true; fb.textContent = 'フォロー解除'; fb.className = 'btn btn-unfollow'; toast('フォローしました', 'success') }
        } catch (e) { toast(e.message, 'error') }
        finally { fb.disabled = false }
        if (profile.isFollowing) fb.className = 'btn btn-unfollow'
      }
      $('#b-dm').onclick = () => nav(`/dms/${profile.id}`)
    } else {
      $('#b-edit')?.addEventListener('click', () => nav('/settings'))
    }
  } catch (e) { m.innerHTML = `<div class="error-page"><div class="err-card"><p>${esc(e.message)}</p><button class="btn btn-secondary" onclick="history.back()">戻る</button></div></div>` }
}

// ── PAGE: Search ──────────────────────────────────────────────────────
let searchTimer
function pSearch() {
  const m = $('#main-content')
  m.innerHTML = `<div class="feed-head"><h2>🔍 ユーザー検索</h2></div><div class="post-form"><input id="search-in" placeholder="ユーザー名を検索..." style="width:100%;background:transparent;border:none;color:var(--text);font-family:inherit;font-size:.92rem;outline:none;padding:.4rem 0" autofocus /></div><div id="search-results"></div>`
  $('#search-in').oninput = function () {
    clearTimeout(searchTimer)
    const q = this.value.trim()
    if (q.length < 2) { $('#search-results').innerHTML = ''; return }
    searchTimer = setTimeout(async () => {
      const r = $('#search-results'); r.innerHTML = '<div class="skel skeleton"></div>'
      try {
        const users = await api(`/users/search/${encodeURIComponent(q)}`)
        if (!users.length) { r.innerHTML = '<div class="empty">該当なし</div>'; return }
        r.innerHTML = users.map(u => `<div class="post search-card" data-u="${esc(u.username)}"><div class="post-head"><span class="post-author">@${esc(u.username)}</span></div>${u.displayName ? `<div class="post-body" style="color:var(--text2);font-size:.85rem">${esc(u.displayName)}</div>` : ''}</div>`).join('')
        $$('.search-card').forEach(c => c.onclick = () => nav(`/profile/${c.dataset.u}`))
      } catch (e) { r.innerHTML = `<div class="error">${esc(e.message)}</div>` }
    }, 300)
  }
}

// ── PAGE: DMs ─────────────────────────────────────────────────────────
async function pDms(userId) {
  const m = $('#main-content')
  if (userId) return openChat(userId)
  m.innerHTML = `<div class="feed-head"><h2>💬 DM</h2></div><div id="dm-list"><div class="skel skeleton"></div></div>`
  try {
    const dms = await api('/dms?limit=50')
    const list = $('#dm-list')
    if (!dms.length) { list.innerHTML = '<div class="empty"><span class="empty-icon">📭</span>まだDMがありません</div>'; return }
    const convs = new Map()
    dms.forEach(d => {
      const pid = d.from.id === S.user.id ? d.to.id : d.from.id
      const partner = d.from.id === S.user.id ? d.to : d.from
      if (!convs.has(pid)) convs.set(pid, { partner, latest: d, unread: 0 })
      const c = convs.get(pid)
      if (!d.isRead && d.from.id !== S.user.id) c.unread++
      if (new Date(d.createdAt) > new Date(c.latest.createdAt)) c.latest = d
    })
    list.innerHTML = Array.from(convs.values()).sort((a, b) => new Date(b.latest.createdAt) - new Date(a.latest.createdAt)).map(c => `<div class="post dm-conv" data-uid="${c.partner.id}"><div class="post-head"><span class="post-author">@${esc(c.partner.username)}</span><span class="post-date">${ago(c.latest.createdAt)}</span></div><div class="post-body" style="color:var(--text2);font-size:.88rem">${esc(c.latest.content.slice(0, 80))}${c.latest.content.length > 80 ? '...' : ''}</div>${c.unread ? `<span class="badge" style="display:inline;margin-top:.4rem">${c.unread}</span>` : ''}</div>`).join('')
    $$('.dm-conv').forEach(c => c.onclick = () => openChat(c.dataset.uid))
    dms.filter(d => !d.isRead && d.from.id !== S.user.id).forEach(d => api(`/dms/${d.id}/read`, { method: 'PUT' }).catch(() => {}))
    S.unreadDm = 0; updateBadge()
  } catch (e) { $('#dm-list').innerHTML = `<div class="error">${esc(e.message)}</div>` }
}

async function openChat(userId) {
  const m = $('#main-content')
  m.innerHTML = '<div class="loading-page">読み込み中...</div>'
  try {
    const dms = await api('/dms?limit=200')
    const chat = dms.filter(d => (d.from.id === S.user.id && d.to.id === userId) || (d.from.id === userId && d.to.id === S.user.id)).reverse()
    const partner = chat[0]?.from.id === userId ? chat[0].from : chat[0]?.to
    const name = partner?.username || 'unknown'
    m.innerHTML = `<div class="feed-head"><button class="btn btn-secondary" id="dm-back" style="font-size:.78rem;padding:.35rem .7rem">← 戻る</button><h2>@${esc(name)}</h2></div><div id="dm-msgs" style="display:flex;flex-direction:column;gap:.5rem;margin-bottom:1rem;max-height:55vh;overflow-y:auto;padding:.5rem 0">${chat.map(d => `<div class="post ${d.from.id === S.user.id ? 'dm-sent' : 'dm-received'}" style="max-width:75%;${d.from.id === S.user.id ? 'margin-left:auto' : ''}"><div class="post-body" style="font-size:.88rem">${esc(d.content)}</div><div class="post-date" style="text-align:right;margin-top:.25rem">${ago(d.createdAt)}</div></div>`).join('')}</div><div class="post-form"><textarea id="dm-in" placeholder="メッセージ..." rows="2" maxlength="5000"></textarea><div class="post-foot"><span class="char-count" id="dm-char">0</span><button class="btn btn-primary" id="dm-send">送信</button></div></div>`
    $('#dm-back').onclick = () => nav('/dms')
    const inp = $('#dm-in')
    inp.oninput = () => { $('#dm-char').textContent = `${inp.value.length} / 5000` }
    const sendMsg = async () => {
      const content = inp.value.trim(); if (!content) return
      const btn = $('#dm-send'); btn.disabled = true
      try {
        const sk = getSK(S.user.username); if (!sk) throw new Error('秘密鍵が見つかりません')
        const sig = hex(ed.sign(enc.encode(content), dehex(sk)))
        await api(`/dms/${userId}`, { method: 'POST', body: { content, signature: sig } })
        const box = $('#dm-msgs')
        const el = document.createElement('div')
        el.className = 'post dm-sent'; el.style.cssText = 'max-width:75%;margin-left:auto'
        el.innerHTML = `<div class="post-body" style="font-size:.88rem">${esc(content)}</div><div class="post-date" style="text-align:right;margin-top:.25rem">たった今</div>`
        box.appendChild(el); box.scrollTop = box.scrollHeight
        inp.value = ''; $('#dm-char').textContent = '0 / 5000'
        toast('送信しました', 'success')
      } catch (e) { toast(e.message, 'error') }
      finally { btn.disabled = false }
    }
    $('#dm-send').onclick = sendMsg
    inp.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMsg() }
    const box = $('#dm-msgs'); if (box) box.scrollTop = box.scrollHeight
  } catch (e) { m.innerHTML = `<div class="error-page"><div class="err-card"><p>${esc(e.message)}</p><button class="btn btn-secondary" onclick="history.back()">戻る</button></div></div>` }
}

// ── PAGE: Settings ────────────────────────────────────────────────────
function pSettings() {
  const m = $('#main-content'), u = S.user
  m.innerHTML = `<div class="settings"><div class="feed-head"><h2>⚙️ 設定</h2></div><div class="auth-card" style="max-width:100%"><form class="form" id="f-set"><div class="field"><label>表示名</label><input id="set-name" value="${esc(u.displayName || '')}" maxlength="64" /></div><div class="field"><label>自己紹介</label><textarea id="set-bio" rows="3" maxlength="500" style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r2);padding:.65rem .85rem;color:var(--text);font-family:inherit;font-size:.92rem;resize:vertical;outline:none">${esc(u.bio || '')}</textarea></div><div class="field"><label>アバターURL</label><input id="set-av" value="${esc(u.avatarUrl || '')}" type="url" /></div><div class="error" id="set-err" style="display:none"></div><div class="info" id="set-ok" style="display:none"></div><button type="submit" class="btn btn-primary" id="set-btn" style="width:100%">保存</button></form></div><div class="auth-card" style="max-width:100%;margin-top:.8rem"><p style="font-size:.82rem;color:var(--text2);margin-bottom:.5rem">ユーザー名: <code>${esc(u.username)}</code></p><button class="btn btn-secondary" id="btn-key" style="font-size:.78rem">秘密鍵をコピー</button></div></div>`
  $('#f-set').onsubmit = async e => {
    e.preventDefault()
    const btn = $('#set-btn'), err = $('#set-err'), ok = $('#set-ok')
    btn.disabled = true; err.style.display = 'none'; ok.style.display = 'none'
    try {
      const body = { displayName: $('#set-name').value.trim(), bio: $('#set-bio').value.trim(), avatarUrl: $('#set-av').value.trim() }
      const up = await api('/users/me', { method: 'PUT', body })
      Object.assign(S.user, { displayName: up.displayName, bio: up.bio, avatarUrl: up.avatarUrl })
      setUser(S.user); updateNav()
      ok.textContent = '✅ 保存しました'; ok.style.display = ''
      toast('プロフィールを更新しました', 'success')
    } catch (e) { err.textContent = e.message; err.style.display = '' }
    finally { btn.disabled = false }
  }
  $('#btn-key').onclick = () => {
    const sk = getSK(u.username)
    if (!sk) { toast('秘密鍵が見つかりません', 'error'); return }
    navigator.clipboard.writeText(sk).then(() => toast('コピーしました', 'success')).catch(() => prompt('コピー:', sk))
  }
}

// ── DM Polling ────────────────────────────────────────────────────────
let dmPoll
function pollDm() {
  clearInterval(dmPoll)
  dmPoll = setInterval(async () => {
    if (!S.token || document.visibilityState !== 'visible') return
    try { const { count } = await api('/dms/unread/count'); S.unreadDm = count; updateBadge() } catch {}
  }, 12000)
}

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  const su = getUser(), st = getToken(), ss = su ? getSK(su.username) : null
  if (su && st && ss) {
    try {
      const r = await api('/auth/verify', { token: st })
      if (r.valid && r.user) login(r.user, st)
      else {
        const sig = hex(ed.sign(enc.encode(`koshi:login:${su.username}`), dehex(ss)))
        const { token } = await api('/auth/login', { method: 'POST', body: { username: su.username, signature: sig } })
        const p = await api(`/users/${su.username}`, { token })
        login(p, token)
      }
    } catch { S.user = su; S.token = st; updateNav() }
  }
  S.ready = true
  $('#loading-screen').style.display = 'none'
  $('#app').style.display = 'flex'
  render()
}

// ── Events ────────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const a = e.target.closest('[data-nav]')
  if (a) { e.preventDefault(); const h = a.getAttribute('href'); if (h) nav(h.slice(1)) }
  if (e.target.id === 'btn-logout') { login(null, null); nav('/'); toast('ログアウトしました', 'info') }
})
window.addEventListener('popstate', render)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.user && route().page === 'feed') loadFeed()
})

init()
