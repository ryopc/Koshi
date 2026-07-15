interface FollowButtonProps {
  isFollowing: boolean
  isLoading?: boolean
  onFollow: () => void
  onUnfollow: () => void
}

export default function FollowButton({
  isFollowing,
  isLoading,
  onFollow,
  onUnfollow,
}: FollowButtonProps) {
  return (
    <button
      onClick={isFollowing ? onUnfollow : onFollow}
      disabled={isLoading}
      className={isFollowing ? 'btn-unfollow' : 'btn-follow'}
    >
      {isLoading ? '...' : isFollowing ? 'フォロー中' : 'フォローする'}
    </button>
  )
}
