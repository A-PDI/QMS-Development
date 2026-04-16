import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

let _toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback(({ title, description, variant = 'default', duration = 4000 }) => {
    const id = ++_toastId
    setToasts(prev => [...prev, { id, title, description, variant }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  // Convenience wrapper used by pages: showToast(message, 'success' | 'error')
  const showToast = useCallback((message, type = 'default') => {
    toast({
      title: message,
      variant: type === 'error' ? 'destructive' : 'default',
    })
  }, [toast])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast, showToast, toasts, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
