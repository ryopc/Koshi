import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-logo">
          <Link to="/">🌊 koshi</Link>
        </div>
        <ul className="sidebar-nav">
          <li><Link to="/">🏠 タイムライン</Link></li>
          {user && (
            <li>
              <Link to={`/profile/${user.username}`}>👤 プロフィール</Link>
            </li>
          )}
        </ul>
        <div className="sidebar-footer">
          {user && (
            <>
              <p className="sidebar-user">@{user.username}</p>
              <button onClick={handleLogout} className="btn-logout">ログアウト</button>
            </>
          )}
          <div className="terminal-hint">
            <p>💻 ターミナル版でもどうぞ</p>
            <code>npm i -g @ryopc/koshi</code>
          </div>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
