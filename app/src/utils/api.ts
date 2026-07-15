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

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

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
