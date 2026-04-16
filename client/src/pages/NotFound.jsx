import { useNavigate } from 'react-router-dom'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center">
        <div className="text-5xl sm:text-6xl font-bold text-pdi-navy mb-3 sm:mb-4">404</div>
        <div className="text-gray-500 mb-5 sm:mb-6 text-sm sm:text-base">Page not found</div>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-3 bg-pdi-navy text-white rounded-lg text-sm hover:bg-pdi-navy/90 min-h-[44px]"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}
