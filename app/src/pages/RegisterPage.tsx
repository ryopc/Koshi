import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerUser, getUserProfile } from '../utils/api'
import { generateKeyPair } from '../utils/crypto'
import { saveSecretKey } from '../utils/localStorage'
import { useAuthStore } from '../store/auth'

export default function RegisterPage() {
  const [username, setUsername] = useState('gast-')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [keyGenerated, setKeyGenerated] = useState(false)
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    // gast- prefix check
    if (!username.startsWith('gast-')) {
      setError('ユーザー名は gast- から始まる必要があります')
      return
    }
    if (username.length < 6) {
      setError('ユーザー名が短すぎます (例: gast-taro)')
      return
    }
    if (!/^gast-[a-z0-9_-]+$/.test(username)) {
      setError('使用できる文字: 半角英数字・ハイフン・アンダースコア')
      return
    }

    setIsLoading(true)
    try {
      // Ed25519 キーペア自動生成
      const { publicKey, secretKey } = generateKeyPair()
      setKeyGenerated(true)

      // 秘密鍵をローカルストレージに保存
      saveSecretKey(username, secretKey)

      // API に登録
      const { token } = await registerUser(username, publicKey)
      const profile = await getUserProfile(username, token)
      login(profile, token, secretKey)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました')
      setKeyGenerated(false)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">🌊 koshi</h1>
        <p className="auth-subtitle">新規登録</p>
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
            <small>gast- から始まるユーザー名のみ使用可能です</small>
          </div>
          {error && <p className="error-msg">{error}</p>}
          {keyGenerated && (
            <p className="info-msg">🔑 Ed25519 キーペアを生成中...</p>
          )}
          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading ? '登録中...' : 'アカウントを作成'}
          </button>
        </form>
        <div className="auth-notice">
          <p>⚠️ 秘密鍵はこのデバイスに自動保存されます</p>
          <p>他のデバイスでのログインにはターミナル版をご利用ください</p>
        </div>
        <p className="auth-link">
          すでにアカウントをお持ちの方は{' '}
          <Link to="/login">ログイン</Link>
        </p>
      </div>
    </div>
  )
}
