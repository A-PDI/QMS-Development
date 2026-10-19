import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Upload, Loader2, X } from 'lucide-react'
import { useCreateEnvelope, esignError } from '../../hooks/useEsign'
import { useToast } from '../../hooks/useToast'
import { formatFileSize } from '../../lib/utils'

const MAX_MB = 25

export default function EsignNew() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const create = useCreateEnvelope()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [routing, setRouting] = useState('sequential')
  const [error, setError] = useState('')

  function choose(f) {
    setError('')
    if (!f) return
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setError('Choose a PDF file.'); return }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`The PDF must be ${MAX_MB} MB or smaller.`); return }
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''))
  }

  async function submit(e) {
    e.preventDefault()
    if (!file) { setError('Choose a PDF to send.'); return }
    try {
      const env = await create.mutateAsync({ file, title: title.trim(), message: message.trim(), routing })
      navigate(`/esign/${env.id}/edit`, { replace: true })
    } catch (err) {
      const msg = await esignError(err, 'Upload failed')
      setError(msg)
      showToast(msg, 'error')
    }
  }

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <button onClick={() => navigate('/esign')} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-pdi-navy">
          <ArrowLeft size={15} /> E-Sign
        </button>
        <h1 className="mt-1 text-xl sm:text-2xl font-bold text-pdi-navy">Send a document for signature</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
          Upload a PDF. Signature, date and name fields are detected automatically — you review them next.
        </p>
      </div>

      <form onSubmit={submit} className="p-4 sm:p-6 max-w-2xl space-y-5">
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0]) }}
          className={`rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors bg-white ${
            dragging ? 'border-pdi-navy bg-pdi-frost' : 'border-gray-300 hover:border-pdi-navy hover:bg-pdi-frost/50'
          }`}
        >
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileText size={28} className="text-pdi-navy" />
              <div className="text-left min-w-0">
                <div className="text-sm font-semibold text-pdi-navy truncate max-w-[18rem]">{file.name}</div>
                <div className="text-xs text-gray-500">{formatFileSize(file.size)}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null) }}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                aria-label="Remove file"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <Upload size={26} className="mx-auto text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">Drop a PDF here or click to browse</p>
              <p className="text-xs text-gray-400 mt-0.5">PDF only · up to {MAX_MB} MB</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => { choose(e.target.files?.[0]); e.target.value = '' }}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-pdi-charcoal mb-1" htmlFor="es-title">Document title</label>
            <input
              id="es-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Supplier NDA — Acme Machining"
              className="w-full rounded-md border border-pdi-steel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-pdi-charcoal mb-1" htmlFor="es-msg">Message to signers <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              id="es-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Shown in the invitation e-mail and on the signing page."
              className="w-full rounded-md border border-pdi-steel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pdi-navy"
            />
          </div>
          <fieldset>
            <legend className="block text-sm font-medium text-pdi-charcoal mb-1">Signing order</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                ['sequential', 'One after another', 'Each signer is invited when the previous one finishes.'],
                ['parallel', 'All at once', 'Everyone is invited immediately and can sign in any order.'],
              ].map(([value, label, hint]) => (
                <label key={value} className={`flex gap-2 rounded-lg border p-3 cursor-pointer ${routing === value ? 'border-pdi-navy bg-pdi-frost/40' : 'border-gray-200'}`}>
                  <input type="radio" name="routing" value={value} checked={routing === value} onChange={() => setRouting(value)} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium text-pdi-navy">{label}</span>
                    <span className="block text-xs text-gray-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {error && <p className="text-sm text-pdi-red">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => navigate('/esign')} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button
            type="submit"
            disabled={!file || create.isPending}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-pdi-navy text-white hover:bg-pdi-navy-light disabled:opacity-50"
          >
            {create.isPending && <Loader2 size={15} className="animate-spin" />}
            Upload &amp; place fields
          </button>
        </div>
      </form>
    </div>
  )
}
