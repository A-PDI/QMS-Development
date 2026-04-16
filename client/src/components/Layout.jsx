import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import { ToastContainer } from './ui/toast'
import { useToast } from '../hooks/useToast'

export default function Layout() {
  const { toasts, dismiss } = useToast()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close the drawer whenever the route changes — belt-and-suspenders in case
  // a nav path doesn't flow through the Sidebar's onClick handler.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Lock body scroll while the mobile drawer is open so the underlying page
  // doesn't scroll when the user swipes inside the drawer.
  useEffect(() => {
    if (drawerOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [drawerOpen])

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar — hidden on md and up */}
        <header className="md:hidden flex items-center justify-between bg-white border-b border-gray-200 px-4 py-2.5 shadow-sm flex-shrink-0">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="p-2 -ml-2 rounded-lg text-pdi-navy hover:bg-pdi-frost active:bg-pdi-steel/40"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/pdi-logo.png"
              alt="PDI"
              className="h-7 w-auto object-contain flex-shrink-0"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
            <span className="text-xs font-semibold text-pdi-navy uppercase tracking-wider truncate">Quality Control</span>
          </div>
          {/* Spacer to balance the hamburger icon so the title stays centered */}
          <div className="w-9 flex-shrink-0" aria-hidden="true" />
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </div>
  )
}
