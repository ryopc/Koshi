import type { UserProfile } from '../utils/api'
import FollowButton from './FollowButton'

interface ProfileCardProps {
  profile: UserProfile
  isSelf: boolean
  isFollowLoading: boolean
  onFollow: () => void
  onUnfollow: () => void
}

export default function ProfileCard({
  profile,
  isSelf,
  isFollowLoading,
  onFollow,
  onUnfollow,
}: ProfileCardProps) {
  return (
    <div className="profile-card">
      <div className="profile-avatar">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt={profile.username} />
        ) : (
          <div className="avatar-placeholder">
            {profile.username.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="profile-info">
        <h2 className="profile-username">@{profile.username}</h2>
        {profile.displayName && <p className="profile-displayname">{profile.displayName}</p>}
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        <div className="profile-stats">
          <span><strong>{profile.followersCount}</strong> フォロワー</span>
          <span><strong>{profile.followingCount}</strong> フォロー中</span>
        </div>
        {!isSelf && (
          <FollowButton
            isFollowing={profile.isFollowing ?? false}
            isLoading={isFollowLoading}
            onFollow={onFollow}
            onUnfollow={onUnfollow}
          />
        )}
      </div>
    </div>
  )
}
