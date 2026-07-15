import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth.ts'
import { useRestoreAuth } from './hooks/useRestoreAuth.ts'
import Layout from './layouts/Layout.tsx'
import LoginPage from './pages/LoginPage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import FeedPage from './pages/FeedPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import DMPage from './pages/DMPage.tsx'
import './App.css'

function App() {
  // Restore session from localStorage on mount
  useRestoreAuth()

  const { user } = useAuthStore()

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected routes */}
        {user ? (
          <Route element={<Layout />}>
            <Route path="/" element={<FeedPage />} />
            <Route path="/profile/:username" element={<ProfilePage />} />
            <Route path="/dms/:username?" element={<DMPage />} />
          </Route>
        ) : (
          <Route path="/*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </BrowserRouter>
  )
}

export default App
