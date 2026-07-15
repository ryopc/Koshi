// DM機能はターミナル版をご利用ください
import { Link } from 'react-router-dom'

export default function DMPage() {
  return (
    <div className="dm-page">
      <div className="dm-notice">
        <h2>💬 ダイレクトメッセージ</h2>
        <p>DM 機能はターミナル版でご利用いただけます。</p>
        <code>npm install -g @ryopc/koshi</code>
        <br />
        <code>kb dm &lt;username&gt; &lt;message&gt;</code>
        <Link to="/" className="btn-secondary" style={{ marginTop: '1rem', display: 'inline-block' }}>
          タイムラインに戻る
        </Link>
      </div>
    </div>
  )
}
