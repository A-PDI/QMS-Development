import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, PlusCircle, LogOut, Shield, AlertTriangle, Settings, X, Bell, User, BarChart2, FileImage, KeyRound, Gauge } from 'lucide-react'
import { useMsal } from '@azure/msal-react'
import { isEntraConfigured } from '../lib/msalConfig'
import { getUser, clearAuth } from '../lib/auth'
import { useQualityAlertCount } from '../hooks/useQualityAlerts'
import { useToast } from '../hooks/useToast'
import api from '../lib/api'
import { NAV_ITEMS, visibleNavItems } from '../lib/nav'

// Icon components for the shared nav definition (see lib/nav.js — kept there,
// icon-free, so the visibility rules can be reused by the route guards).
const NAV_ICONS = {
  dashboard: LayoutDashboard,
  user: User,
  clipboard: ClipboardList,
  plus: PlusCircle,
  alert: AlertTriangle,
  bell: Bell,
  drawing: FileImage,
  chart: BarChart2,
  settings: Settings,
  gauge: Gauge,
}

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.next.length < 8) { setError('New password must be at least 8 characters'); return }
    if (form.next !== form.confirm) { setError('Passwords do not match'); return }
    setSaving(true)
    try {
      await api.patch('/auth/password', { current_password: form.current, new_password: form.next })
      onClose(true)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Change Password</h3>
          <button type="button" onClick={() => onClose(false)} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Current Password</label>
            <input
              type="password"
              required
              autoFocus
              value={form.current}
              onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Password <span className="text-gray-400 font-normal">(min 8 characters)</span></label>
            <input
              type="password"
              required
              value={form.next}
              onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Confirm New Password</label>
            <input
              type="password"
              required
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-pdi-navy min-h-[40px]"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => onClose(false)}
              className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm bg-pdi-navy text-white rounded-lg hover:bg-pdi-navy-light disabled:opacity-50 min-h-[40px]"
            >
              {saving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EntraSignOutButton({ onAfter }) {
  const { instance } = useMsal()
  function handleLogout() {
    clearAuth()
    onAfter?.()
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin })
  }
  return <SignOutButton onClick={handleLogout} />
}

function LocalSignOutButton({ onAfter }) {
  const navigate = useNavigate()
  function handleLogout() {
    clearAuth()
    onAfter?.()
    navigate('/login')
  }
  return <SignOutButton onClick={handleLogout} />
}

function SignOutButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm text-pdi-steel hover:bg-white/10 hover:text-white transition-colors min-h-[44px]"
    >
      <LogOut size={16} />
      Sign Out
    </button>
  )
}

export default function Sidebar({ open = false, onClose }) {
  const user = getUser()
  const { data: qualityAlertCount = 0 } = useQualityAlertCount()
  const { showToast } = useToast()
  const [showChangePw, setShowChangePw] = useState(false)

  function handleNavClick() {
    if (onClose) onClose()
  }

  // Visibility (admin-only items, per-user page permissions) lives in lib/nav.js
  // so the sidebar and the route guards can never disagree.
  const navItems = visibleNavItems(user, NAV_ITEMS)

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-gradient-to-b from-pdi-navy to-pdi-navy-light shadow-xl
          transform transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:shadow-xl md:flex-shrink-0
        `}
        aria-label="Primary navigation"
      >
        <div className="px-5 py-6 border-b border-white/10 flex flex-col items-center relative">
          <img
            src="/pdi-logo.png"
            alt="PDI"
            className="h-16 w-auto object-contain"
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
          <div className="text-pdi-steel/80 text-xs font-semibold tracking-wider uppercase mt-2">Quality Control</div>
          <button
            type="button"
            onClick={onClose}
            className="md:hidden absolute top-3 right-3 p-2 rounded-lg text-pdi-steel hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-1">
          {navItems.map(({ to, icon, label, end, accent, alertKey }) => {
            const Icon = NAV_ICONS[icon] || LayoutDashboard
            return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors min-h-[44px] ${
                  isActive
                    ? accent
                      ? 'bg-pdi-amber text-white font-semibold shadow-sm'
                      : 'bg-white/15 text-white font-semibold'
                    : accent
                    ? 'text-pdi-amber hover:bg-white/10 hover:text-pdi-amber font-medium'
                    : 'text-pdi-steel hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={16} className="flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {alertKey === 'qualityAlerts' && qualityAlertCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {qualityAlertCount > 99 ? '99+' : qualityAlertCount}
                </span>
              )}
            </NavLink>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <div className="px-3 py-2 mb-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-pdi-steel/60 truncate">{user?.name}</div>
              <div className="text-xs text-pdi-steel/40 truncate capitalize">{user?.role}</div>
            </div>
            {!isEntraConfigured && (
              <button
                type="button"
                onClick={() => setShowChangePw(true)}
                title="Change Password"
                className="flex-shrink-0 p-1.5 rounded text-pdi-steel/50 hover:bg-white/10 hover:text-pdi-steel transition-colors"
              >
                <KeyRound size={14} />
              </button>
            )}
          </div>
          {isEntraConfigured ? (
            <EntraSignOutButton onAfter={onClose} />
          ) : (
            <LocalSignOutButton onAfter={onClose} />
          )}
        </div>
      </aside>

      {showChangePw && (
        <ChangePasswordModal
          onClose={(success) => {
            setShowChangePw(false)
            if (success) showToast('Password updated successfully', 'success')
          }}
        />
      )}
    </>
  )
}
