import { Link } from 'react-router-dom'
import type { Post } from '../utils/api'

interface PostCardProps {
  post: Post
}

export default function PostCard({ post }: PostCardProps) {
  const date = new Date(post.createdAt).toLocaleString('ja-JP')
  return (
    <div className="post-card">
      <div className="post-header">
        <Link to={`/profile/${post.author.username}`} className="post-author">
          @{post.author.username}
        </Link>
        <span className="post-date">{date}</span>
      </div>
      <p className="post-content">{post.content}</p>
      <div className="post-footer">
        <span className="sig-badge" title={`Sig: ${post.signature.slice(0, 16)}...`}>
          🔐 署名済み
        </span>
      </div>
    </div>
  )
}
