import { useState } from 'react'
import { createPost } from '../utils/api'
import { signMessage } from '../utils/crypto'
import { usePostsStore } from '../store/posts'

export function useCreatePost(token: string, secretKey: string) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prependPost = usePostsStore((s) => s.prependPost)

  const submit = async (content: string): Promise<boolean> => {
    if (!content.trim()) return false
    setIsLoading(true)
    setError(null)
    try {
      const signature = signMessage(content, secretKey)
      const post = await createPost(content, signature, token)
      prependPost(post)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create post')
      return false
    } finally {
      setIsLoading(false)
    }
  }

  return { submit, isLoading, error }
}
