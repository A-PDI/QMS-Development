import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MsalProvider } from '@azure/msal-react'
import { ToastProvider } from './contexts/ToastContext'
import { msalInstance, isEntraConfigured } from './lib/msalConfig'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

const appTree = (
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <App />
    </ToastProvider>
  </QueryClientProvider>
)

// Only wrap with MsalProvider when Entra credentials are configured.
// Without credentials (local demo mode) the app falls back to email/password login
// and MsalProvider is not mounted — so useMsal() must never be called unconditionally.
const root = isEntraConfigured && msalInstance
  ? <MsalProvider instance={msalInstance}>{appTree}</MsalProvider>
  : appTree

createRoot(document.getElementById('root')).render(
  <StrictMode>{root}</StrictMode>
)
