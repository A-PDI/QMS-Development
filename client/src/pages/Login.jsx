import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { isEntraConfigured, loginRequest } from '../lib/msalConfig'
import { setAuth, getToken } from '../lib/auth'
import { useToast } from '../hooks/useToast'
import api from '../lib/api'

// ── Microsoft Entra sign-in ───────────────────────────────────────────────────
// This component is only ever rendered when isEntraConfigured === true, which
// means MsalProvider IS present in the tree. Calling useMsal() here is therefore
// always within a valid provider context — no hook-rules violation.
function EntraLogin() {
  const { instance, accounts, inProgress } = useMsal()
  const navigate = useNavigate()
  const [exchanging, setExchanging] = useState(false)
  const [error, setError] = useState(null)

  // After Microsoft redirects back, MSAL resolves the account. We then silently
  // acquire an ID token and exchange it for our app's own JWT.
  useEffect(() => {
    if (
      accounts.length > 0 &&
      !getToken() &&
      !exchanging &&
      inProgress === InteractionStatus.None
    ) {
      setExchanging(true)
      setError(null)
      instance
        .acquireTokenSilent({ ...loginRequest, account: accounts[0] })
        .then(response => api.post('/auth/entra', { idToken: response.idToken }))
        .then(({ data }) => {
          setAuth(data.token, data.user)
          navigate('/', { replace: true })
        })
        .catch(err => {
          const msg =
            err?.response?.data?.error ||
            'Sign-in failed. Your account may not have access to this application.'
          setError(msg)
          // Clear the MSAL session so the user can try again cleanly
          instance.logoutRedirect({ onRedirectNavigate: () => false })
        })
        .finally(() => setExchanging(false))
    }
  }, [accounts, inProgress, instance, navigate, exchanging])

  const isBusy =
    exchanging ||
    inProgress === InteractionStatus.HandleRedirect ||
    inProgress === InteractionStatus.Login

  if (isBusy) {
    return (
      <div className="min-h-screen bg-pdi-navy flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-2xl font-bold mb-2">PDI</div>
          <div className="text-sm opacity-75">Signing you in…</div>
          <div className="mt-4 flex justify-center">
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <LoginShell error={error}>
      <button
        onClick={() => { setError(null); instance.loginRedirect(loginRequest) }}
        className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-lg text-white text-sm font-semibold transition-opacity hover:opacity-90 min-h-[44px]"
        style={{ backgroundColor: '#0078D4' }}
      >
        {/* Microsoft four-square logo */}
        <svg width="20" height="20" viewBox="0 0 21 21" fill="none" aria-hidden="true">
          <rect x="1"  y="1"  width="9" height="9" fill="#F25022" />
          <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" />
          <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" />
          <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
        Sign in with Microsoft
      </button>
      <p className="mt-6 text-center text-xs text-gray-400">
        Use your PDI Microsoft 365 account
      </p>
    </LoginShell>
  )
}

// ── Local email/password sign-in (demo / dev without Entra credentials) ───────
function LocalLogin() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      setAuth(data.token, data.user)
      navigate('/', { replace: true })
    } catch (err) {
      showToast(err?.response?.data?.error || err.message || 'Login failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <LoginShell>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[44px]"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="you@pdi.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy min-h-[44px]"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-pdi-navy text-white py-3 rounded-lg text-sm font-semibold hover:bg-pdi-navy/90 disabled:opacity-50 transition-colors mt-2 min-h-[44px]"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </LoginShell>
  )
}

// ── Shared login card shell ───────────────────────────────────────────────────
function LoginShell({ children, error }) {
  return (
    <div className="min-h-screen bg-pdi-navy flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 sm:p-8">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-pdi-navy">PDI</div>
          <div className="text-gray-500 text-sm mt-1">Inspection Management System</div>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

// ── Route component ───────────────────────────────────────────────────────────
// Picks the right login form automatically based on whether Entra credentials
// are configured. No further setup required for either mode.
export default function Login() {
  const navigate = useNavigate()

  useEffect(() => {
    if (getToken()) navigate('/', { replace: true })
  }, [navigate])

  return isEntraConfigured ? <EntraLogin /> : <LocalLogin />
}
