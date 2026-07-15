import { useState } from 'react'
import { followUser, unfollowUser } from '../utils/api'

export function useFollowUser(token: string) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const follow = async (userId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      await followUser(userId, token)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to follow')
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const unfollow = async (userId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      await unfollowUser(userId, token)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unfollow')
      return false
    } finally {
      setIsLoading(false)
    }
  }

  return { follow, unfollow, isLoading, error }
}
