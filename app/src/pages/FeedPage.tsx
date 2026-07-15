import { useCallback } from 'react'
import { getFeed } from '../utils/api'
import { useAuthStore } from '../store/auth'
import { usePostsStore } from '../store/posts'
import { usePollingUpdate } from '../hooks/usePollingUpdate'
import { useCreatePost } from '../hooks/useCreatePost'
import PostCard from '../components/PostCard'
import PostForm from '../components/PostForm'

export default function FeedPage() {
  const { token, secretKey } = useAuthStore()
  const { posts, setPosts, isLoading, setLoading } = usePostsStore()
  const { submit, isLoading: isPosting, error: postError } = useCreatePost(
    token ?? '',
    secretKey ?? ''
  )

  const fetchFeed = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await getFeed(token)
      setPosts(data)
    } finally {
      setLoading(false)
    }
  }, [token, setPosts, setLoading])

  usePollingUpdate(fetchFeed, 3000)

  return (
    <div className="feed-page">
      <div className="feed-header">
        <h2>🌊 タイムライン</h2>
        <span className="live-badge">● LIVE</span>
      </div>

      <PostForm onSubmit={submit} isLoading={isPosting} />
      {postError && <p className="error-msg">{postError}</p>}

      <div className="posts-list">
        {isLoading && posts.length === 0 ? (
          <p className="loading-msg">読み込み中...</p>
        ) : posts.length === 0 ? (
          <div className="empty-feed">
            <p>🌱 まだ投稿がありません</p>
            <p>最初の投稿をしてみましょう！</p>
          </div>
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>
    </div>
  )
}
