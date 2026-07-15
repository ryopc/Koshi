import { create } from 'zustand'
import type { Post } from '../utils/api'

interface PostsState {
  posts: Post[]
  isLoading: boolean
  error: string | null
  setPosts: (posts: Post[]) => void
  prependPost: (post: Post) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const usePostsStore = create<PostsState>((set) => ({
  posts: [],
  isLoading: false,
  error: null,
  setPosts: (posts) => set({ posts }),
  prependPost: (post) => set((state) => ({ posts: [post, ...state.posts] })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}))
