import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getUserProfile, getUserPosts, type UserProfile, type Post } from '../utils/api'
import { useAuthStore } from '../store/auth'
import { useFollowUser } from '../hooks/useFollowUser'
import { usePollingUpdate } from '../hooks/usePollingUpdate'
import ProfileCard from '../components/ProfileCard'
import PostCard from '../components/PostCard'

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>()
  const { token, user: me } = useAuthStore()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { follow, unfollow, isLoading: isFollowLoading } = useFollowUser(token ?? '')

  const fetchProfile = useCallback(async () => {
    if (!username) return
    try {
      const [profileData, postsData] = await Promise.all([
        getUserProfile(username, token ?? undefined),
        getUserPosts(username, token ?? undefined),
      ])
      setProfile(profileData)
      setPosts(postsData)
    } catch (e) {
      console.error('Failed to fetch profile:', e)
    } finally {
      setIsLoading(false)
    }
  }, [username, token])

  useEffect(() => { fetchProfile() }, [fetchProfile])
  usePollingUpdate(fetchProfile, 5000)

  const handleFollow = async () => {
    if (!profile) return
    const ok = await follow(profile.id)
    if (ok) setProfile((p) => p ? { ...p, isFollowing: true, followersCount: p.followersCount + 1 } : p)
  }

  const handleUnfollow = async () => {
    if (!profile) return
    const ok = await unfollow(profile.id)
    if (ok) setProfile((p) => p ? { ...p, isFollowing: false, followersCount: p.followersCount - 1 } : p)
  }

  if (isLoading) return <div className="loading-page">読み込み中...</div>
  if (!profile) return <div className="error-page">ユーザーが見つかりません</div>

  const isSelf = me?.username === profile.username

  return (
    <div className="profile-page">
      <ProfileCard
        profile={profile}
        isSelf={isSelf}
        isFollowLoading={isFollowLoading}
        onFollow={handleFollow}
        onUnfollow={handleUnfollow}
      />
      <div className="profile-posts">
        <h3>📝 投稿一覧</h3>
        {posts.length === 0 ? (
          <p className="empty-msg">まだ投稿がありません</p>
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>
    </div>
  )
}
