import { useEffect } from 'react'
import { useAuthStore } from '../store/auth'
import { loadUser, loadToken, loadSecretKey } from '../utils/localStorage'

export function useRestoreAuth() {
  useEffect(() => {
    const user = loadUser()
    const token = loadToken()
    if (!user || !token) return
    const secretKey = loadSecretKey(user.username)
    useAuthStore.setState({ user, token, secretKey })
  }, [])
}
