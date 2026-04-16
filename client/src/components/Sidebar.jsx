import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, PlusCircle, LogOut, Shield, AlertTriangle, Settings } from 'lucide-react'
import { useMsal } from '@azure/msal-react'
import { isEntraConfigured } from '../lib/msalConfig'
import { getUser, clearAuth } from '../lib/auth'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/inspections', icon: ClipboardList, label: 'Inspections' },
  { to: '/inspections/new', icon: PlusCircle, label: 'New Inspection', accent: true },
  { to: '/ncrs', icon: AlertTriangle, label: 'NCRs' },
  { to: '/admin', icon: Settings, label: 'Admin' },
]

// Sign-out button that works in both Entra mode and local demo mode.
// useMsal() is only called when MsalProvider is present (isEntraConfigured === true),
// so we split into two components to keep hook calls unconditional within each.
function EntraSignOutButton() {
  const { instance } = useMsal()
  function handleLogout() {
    clearAuth()
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin })
  }
  return <SignOutButton onClick={handleLogout} />
}

function LocalSignOutButton() {
  const navigate = useNavigate()
  function handleLogout() {
    clearAuth()
    navigate('/login')
  }
  return <SignOutButton onClick={handleLogout} />
}

function SignOutButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-pdi-steel hover:bg-white/10 hover:text-white transition-colors"
    >
      <LogOut size={16} />
      Sign Out
    </button>
  )
}

export default function Sidebar() {
  const user = getUser()

  return (
    <div className="w-60 flex flex-col h-full flex-shrink-0 bg-gradient-to-b from-pdi-navy to-pdi-navy-light shadow-xl">

      {/* Logo area */}
      <div className="px-5 py-6 border-b border-white/10 flex flex-col items-center">
        <img
          src="/pdi-logo.png"
          alt="PDI"
          className="h-16 w-auto object-contain"
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
        <div className="text-pdi-steel/80 text-xs font-semibold tracking-wider uppercase mt-2">Quality Control</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 space-y-1">
        {nav.map(({ to, icon: Icon, label, end, accent }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
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
          </NavLink>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-4 h-px bg-white/10" />

      {/* User + logout */}
      <div className="px-3 pb-5 pt-3 space-y-1">
        <div className="px-3 py-2 rounded-lg bg-white/5">
          <div className="flex items-center gap-2 mb-0.5">
            <Shield size={13} className="text-pdi-steel/60" />
            <span className="text-pdi-steel/70 text-xs capitalize">{user?.role?.replace('_', ' ')}</span>
          </div>
          <div className="text-white text-sm font-medium truncate">{user?.name}</div>
          <div className="text-pdi-steel/60 text-xs truncate">{user?.email}</div>
        </div>
        {isEntraConfigured ? <EntraSignOutButton /> : <LocalSignOutButton />}
      </div>
    </div>
  )
}
