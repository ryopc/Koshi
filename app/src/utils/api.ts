const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export async function apiCall(
  endpoint: string,
  options?: RequestInit & { token?: string }
) {
  const { token, ...fetchOptions } = options || {}
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const response = await fetch(`${API_URL}/api${endpoint}`, {
    ...fetchOptions,
    headers,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `API Error: ${response.status}`)
  }
  return response.json()
}

// ===== Types =====
export interface UserProfile {
  id: string
  username: string
  displayName?: string
  bio?: string
  avatarUrl?: string
  followersCount: number
  followingCount: number
  isFollowing?: boolean
}

export interface Post {
  id: string
  author: UserProfile
  content: string
  signature: string
  createdAt: string
}

// ===== Auth API =====
export async function registerUser(username: string, publicKey: string) {
  return apiCall('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, publicKey }),
  })
}

export async function loginUser(username: string, signature: string) {
  return apiCall('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, signature }),
  })
}

// ===== Profile API =====
export async function getUserProfile(username: string, token?: string): Promise<UserProfile> {
  return apiCall(`/users/${username}`, { token })
}

// ===== Follow API =====
export async function followUser(userId: string, token: string) {
  return apiCall(`/users/${userId}/follow`, { method: 'POST', token })
}

export async function unfollowUser(userId: string, token: string) {
  return apiCall(`/users/${userId}/unfollow`, { method: 'POST', token })
}

export async function getFollowers(userId: string, token?: string): Promise<UserProfile[]> {
  return apiCall(`/users/${userId}/followers`, { token })
}

export async function getFollowing(userId: string, token?: string): Promise<UserProfile[]> {
  return apiCall(`/users/${userId}/following`, { token })
}

// ===== Posts API =====
export async function createPost(content: string, signature: string, token: string): Promise<Post> {
  return apiCall('/posts', {
    method: 'POST',
    body: JSON.stringify({ content, signature }),
    token,
  })
}

export async function getFeed(token?: string, limit = 20, offset = 0): Promise<Post[]> {
  return apiCall(`/posts/feed?limit=${limit}&offset=${offset}`, { token })
}

export async function getUserPosts(username: string, token?: string): Promise<Post[]> {
  return apiCall(`/users/${username}/posts`, { token })
}
