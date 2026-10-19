import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Inbox, Loader2, PenLine } from 'lucide-react'
import { useEsignInbox, startInboxSigning, esignError } from '../../hooks/useEsign'
import { useToast } from '../../hooks/useToast'
import { formatDateTime } from '../../lib/utils'

/** Documents sent to the signed-in user's e-mail that are waiting for them. */
export default function EsignInbox() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { data: items = [], isLoading } = useEsignInbox()
  const [opening, setOpening] = useState(null)

  async function open(item) {
    setOpening(item.recipient_id)
    try {
      navigate(await startInboxSigning(item.recipient_id))
    } catch (err) {
      showToast(await esignError(err, 'Could not open the document'), 'error')
      setOpening(null)
    }
  }

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <button onClick={() => navigate('/esign')} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-pdi-navy">
          <ArrowLeft size={15} /> E-Sign
        </button>
        <h1 className="mt-1 text-xl sm:text-2xl font-bold text-pdi-navy flex items-center gap-2"><Inbox size={20} className="text-pdi-amber" /> Waiting for my signature</h1>
      </div>
      <div className="p-4 sm:p-6 max-w-3xl">
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {isLoading ? (
            <div className="text-center text-gray-400 py-12 text-sm">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center text-gray-400 py-12 text-sm">Nothing to sign right now.</div>
          ) : items.map((item) => (
            <div key={item.recipient_id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-pdi-navy truncate">{item.title}</div>
                <div className="text-xs text-gray-500">From {item.sender_name || '—'} · sent {formatDateTime(item.sent_at)}</div>
              </div>
              <button
                onClick={() => open(item)}
                disabled={!!opening}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-pdi-amber text-white hover:brightness-95 disabled:opacity-50"
              >
                {opening === item.recipient_id ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />} Sign
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
