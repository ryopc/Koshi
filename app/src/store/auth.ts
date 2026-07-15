import { create } from 'zustand'
import type { UserProfile } from '../utils/api'
import { saveToken, saveUser, clearAll } from '../utils/localStorage'

interface AuthState {
  user: UserProfile | null
  token: string | null
  secretKey: string | null
  setUser: (user: UserProfile | null) => void
  setToken: (token: string | null) => void
  setSecretKey: (key: string | null) => void
  login: (user: UserProfile, token: string, secretKey: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  secretKey: null,
  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),
  setSecretKey: (secretKey) => set({ secretKey }),
  login: (user, token, secretKey) => {
    saveUser(user)
    saveToken(token)
    set({ user, token, secretKey })
  },
  logout: () => {
    const { user } = get()
    clearAll(user?.username)
    set({ user: null, token: null, secretKey: null })
  },
}))
