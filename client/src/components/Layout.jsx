import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { ToastContainer } from './ui/toast'
import { useToast } from '../hooks/useToast'

export default function Layout() {
  const { toasts, dismiss } = useToast()
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </div>
  )
}
