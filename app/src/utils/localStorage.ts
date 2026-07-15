import type { UserProfile } from './api'

const KEYS = {
  SECRET_KEY: (username: string) => `koshi:sk:${username}`,
  TOKEN: 'koshi:token',
  USER: 'koshi:user',
} as const

// Secret Key
export function saveSecretKey(username: string, secretKey: string) {
  localStorage.setItem(KEYS.SECRET_KEY(username), secretKey)
}
export function loadSecretKey(username: string): string | null {
  return localStorage.getItem(KEYS.SECRET_KEY(username))
}
export function deleteSecretKey(username: string) {
  localStorage.removeItem(KEYS.SECRET_KEY(username))
}

// JWT Token
export function saveToken(token: string) {
  localStorage.setItem(KEYS.TOKEN, token)
}
export function loadToken(): string | null {
  return localStorage.getItem(KEYS.TOKEN)
}
export function deleteToken() {
  localStorage.removeItem(KEYS.TOKEN)
}

// User Profile
export function saveUser(user: UserProfile) {
  localStorage.setItem(KEYS.USER, JSON.stringify(user))
}
export function loadUser(): UserProfile | null {
  const raw = localStorage.getItem(KEYS.USER)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
export function deleteUser() {
  localStorage.removeItem(KEYS.USER)
}

// Clear all koshi data
export function clearAll(username?: string) {
  if (username) deleteSecretKey(username)
  deleteToken()
  deleteUser()
}
