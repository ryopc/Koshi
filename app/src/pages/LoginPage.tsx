import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loginUser, getUserProfile } from '../utils/api'
import { signMessage } from '../utils/crypto'
import { loadSecretKey } from '../utils/localStorage'
import { useAuthStore } from '../store/auth'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!username.startsWith('gast-')) {
      setError('ユーザー名は gast- から始まる必要があります')
      return
    }
    const secretKey = loadSecretKey(username)
    if (!secretKey) {
      setError('このデバイスに秘密鍵が見つかりません。登録してください。')
      return
    }
    setIsLoading(true)
    try {
      const signature = signMessage(`login:${username}`, secretKey)
      const { token } = await loginUser(username, signature)
      const profile = await getUserProfile(username, token)
      login(profile, token, secretKey)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ログインに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">🌊 koshi</h1>
        <p className="auth-subtitle">ターミナルネイティブな分散 SNS</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>ユーザー名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="gast-yourname"
              required
              autoFocus
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
        <p className="auth-link">
          アカウントをお持ちでない方は{' '}
          <Link to="/register">新規登録</Link>
        </p>
        <p className="auth-hint">
          💡 koshi の全機能はターミナル版でご利用いただけます<br />
          <code>npm install -g @ryopc/koshi</code>
        </p>
      </div>
    </div>
  )
}
