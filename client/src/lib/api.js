import axios from 'axios'
import { clearAuth } from './auth'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach the app JWT (obtained from /api/auth/entra) to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pdi_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle expired / invalid app JWTs.
// When the app JWT expires (8h), clear local auth state and send the user to
// /login. Login.jsx will detect the active MSAL session and silently re-exchange
// it for a new app JWT — the user won't need to click "Sign in" again unless
// their Microsoft session has also expired.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearAuth()
      // Give any in-flight UI a tick to unmount cleanly before navigating
      setTimeout(() => { window.location.href = '/login' }, 0)
    }
    return Promise.reject(err)
  }
)

export default api
