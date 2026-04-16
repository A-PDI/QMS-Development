import { useNavigate } from 'react-router-dom'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-6xl font-bold text-pdi-navy mb-4">404</div>
        <div className="text-gray-500 mb-6">Page not found</div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-pdi-navy text-white rounded-lg text-sm hover:bg-pdi-navy/90"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}
