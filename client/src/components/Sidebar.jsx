import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, PlusCircle, LogOut, Shield, AlertTriangle, Settings, X, Bell, User, BarChart2, FileImage } from 'lucide-react'
import { useMsal } from '@azure/msal-react'
import { isEntraConfigured } from '../lib/msalConfig'
import { getUser, clearAuth } from '../lib/auth'
import { useQualityAlertCount } from '../hooks/useQualityAlerts'

const nav = [
  { to: '/',                icon: LayoutDashboard, label: 'Dashboard',       end: true, permKey: 'dashboard' },
  { to: '/my-inspections',  icon: User,            label: 'My Inspections',             permKey: 'my_inspections' },
  { to: '/inspections',     icon: ClipboardList,   label: 'Inspections',                permKey: 'inspections' },
  { to: '/inspections/new', icon: PlusCircle,      label: 'New Inspection', accent: true, permKey: 'new_inspection' },
  { to: '/ncrs',            icon: AlertTriangle,   label: 'NCRs',                       permKey: 'ncrs' },
  { to: '/quality-alerts',  icon: Bell,            label: 'Quality Alerts', alertKey: 'qualityAlerts', permKey: 'quality_alerts' },
  { to: '/drawings',        icon: FileImage,       label: 'Drawings',                   permKey: 'drawings' },
  { to: '/reports',         icon: BarChart2,       label: 'Reports',        adminOnly: true },
  { to: '/admin',           icon: Settings,        label: 'Admin',          adminOnly: true },
]

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

  function handleNavClick() {
    if (onClose) onClose()
  }

  const isAdminRole = user && (user.role === 'admin' || user.role === 'qc_manager')

  // Parse per-user page permissions (null = no restrictions = show all)
  let allowedTabs = null
  if (user?.permissions && !isAdminRole) {
    try {
      const perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions
      if (Array.isArray(perms?.tabs)) allowedTabs = perms.tabs
    } catch (_) {}
  }

  function isNavVisible(item) {
    if (item.adminOnly) return isAdminRole
    if (allowedTabs && item.permKey && !allowedTabs.includes(item.permKey)) return false
    return true
  }

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
          {nav.map(({ to, icon: Icon, label, end, accent, adminOnly, alertKey, permKey }) => {
            if (!isNavVisible({ adminOnly, permKey })) return null
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px] relative ${
                    isActive
                      ? accent
                        ? 'bg-pdi-amber text-white shadow-md'
                        : 'bg-white/15 text-white shadow-sm'
                      : accent
                        ? 'text-pdi-amber-light hover:bg-pdi-amber/20 hover:text-white'
                        : 'text-pdi-steel hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon size={17} />
                {label}
                {alertKey === 'qualityAlerts' && qualityAlertCount > 0 && (
                  <span className="absolute top-1 right-2 flex items-center justify-center w-5 h-5 bg-pdi-amber text-white text-xs font-bold rounded-full">
                    {qualityAlertCount > 9 ? '9+' : qualityAlertCount}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="mx-4 h-px bg-white/10" />

        <div className="px-3 pb-5 pt-3 space-y-1">
          <div className="px-3 py-2 rounded-lg bg-white/5">
            <div className="flex items-center gap-2 mb-0.5">
              <Shield size={13} className="text-pdi-steel/60" />
              <span className="text-pdi-steel/70 text-xs capitalize">{user?.role?.replace('_', ' ')}</span>
            </div>
            <div className="text-white text-sm font-medium truncate">{user?.name}</div>
            <div className="text-pdi-steel/60 text-xs truncate">{user?.email}</div>
          </div>
          {isEntraConfigured ? <EntraSignOutButton onAfter={onClose} /> : <LocalSignOutButton onAfter={onClose} />}
        </div>
      </aside>
    </>
  )
}
