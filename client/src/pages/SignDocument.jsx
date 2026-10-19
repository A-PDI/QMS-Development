import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Loader2, AlertTriangle, CheckCircle2, Download, PenLine, ChevronDown, XCircle, ShieldCheck, LogIn,
} from 'lucide-react'
import { signApi, esignError, saveBlob } from '../hooks/useEsign'
import { fieldToScreen, fieldComplete, remainingFields, initialsOf, FIELD_META } from '../lib/esign'
import PdfPages from '../components/esign/PdfPages'
import SignaturePad from '../components/esign/SignaturePad'

export const RETURN_TO_KEY = 'pdi_return_to'

function todayText() {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function Shell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-pdi-navy text-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src="/pdi-logo.png" alt="PDI" className="h-8 w-auto object-contain" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{title || 'Document signing'}</div>
            {subtitle && <div className="text-xs text-pdi-steel truncate">{subtitle}</div>}
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Centered({ icon: Icon, tone = 'text-gray-500', title, children }) {
  return (
    <div className="max-w-md mx-auto mt-16 px-4 text-center">
      <Icon size={36} className={`mx-auto ${tone}`} />
      <h1 className="mt-3 text-lg font-semibold text-pdi-navy">{title}</h1>
      <div className="mt-2 text-sm text-gray-600 space-y-3">{children}</div>
    </div>
  )
}

/**
 * The page a signer opens from their e-mail: /sign/:token. Public — the token
 * is the credential — and rendered outside the app layout.
 */
export default function SignDocument() {
  const { token } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [view, setView] = useState(null)
  const [pdf, setPdf] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [values, setValues] = useState({})
  const [marks, setMarks] = useState({ signature: null, initials: null })
  const [pad, setPad] = useState(null) // 'signature' | 'initials' | null
  const [consentChecked, setConsentChecked] = useState(false)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [finished, setFinished] = useState(null) // { completed }

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const { data } = await signApi.get(`/${token}`)
      setView(data)
      setValues((prev) => {
        const next = { ...prev }
        for (const f of data.fields) {
          if (next[f.id] === undefined) next[f.id] = f.type === 'checkbox' ? f.value === 'true' : (f.value || '')
        }
        return next
      })
      const doc = await signApi.get(`/${token}/document`, { responseType: 'arraybuffer' })
      setPdf(doc.data)
    } catch (err) {
      setLoadError({ code: err?.response?.data?.code, message: await esignError(err, 'This signing link could not be opened.') })
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const fields = view?.fields || []
  const remaining = useMemo(() => remainingFields(fields, values, marks), [fields, values, marks])
  const required = fields.filter((f) => f.required || ['signature', 'initials'].includes(f.type))
  const consented = !!view?.recipient?.consented
  const canEdit = !!view?.can_sign && consented && !finished

  function goToNext() {
    const next = remaining[0]
    if (!next) return
    document.getElementById(`field-${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function consent() {
    setBusy('consent')
    setActionError('')
    try {
      await signApi.post(`/${token}/consent`)
      setView((v) => ({ ...v, recipient: { ...v.recipient, consented: true } }))
    } catch (err) {
      setActionError(await esignError(err))
    } finally {
      setBusy('')
    }
  }

  async function finish() {
    if (remaining.length) { goToNext(); return }
    setBusy('sign')
    setActionError('')
    try {
      const body = { values }
      if (fields.some((f) => f.type === 'signature')) body.signature = marks.signature
      if (fields.some((f) => f.type === 'initials')) body.initials = marks.initials
      const { data } = await signApi.post(`/${token}/sign`, body)
      setFinished({ completed: !!data.completed })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setActionError(await esignError(err, 'Signing failed. Please try again.'))
    } finally {
      setBusy('')
    }
  }

  async function decline(e) {
    e.preventDefault()
    setBusy('decline')
    setActionError('')
    try {
      await signApi.post(`/${token}/decline`, { reason: declineReason })
      setDeclining(false)
      await load()
    } catch (err) {
      setActionError(await esignError(err))
    } finally {
      setBusy('')
    }
  }

  async function download() {
    setBusy('download')
    try {
      const { data } = await signApi.get(`/${token}/download`, { responseType: 'blob' })
      saveBlob(data, `${view.envelope.title} - signed.pdf`)
    } catch (err) {
      setActionError(await esignError(err, 'Download failed'))
    } finally {
      setBusy('')
    }
  }

  // ── Error states ──
  if (loadError) {
    if (loadError.code === 'LOGIN_REQUIRED') {
      return (
        <Shell>
          <Centered icon={LogIn} tone="text-pdi-navy" title="Sign in to continue">
            <p>{loadError.message}</p>
            <button
              onClick={() => { sessionStorage.setItem(RETURN_TO_KEY, location.pathname); navigate('/login') }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-pdi-navy text-white"
            >
              <LogIn size={16} /> Sign in
            </button>
          </Centered>
        </Shell>
      )
    }
    return (
      <Shell>
        <Centered icon={AlertTriangle} tone="text-pdi-amber" title="This link can't be used">
          <p>{loadError.message}</p>
        </Centered>
      </Shell>
    )
  }

  if (!view) {
    return <Shell><div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-500"><Loader2 size={18} className="animate-spin" /> Opening document…</div></Shell>
  }

  const { envelope, recipient } = view
  const subtitle = `From ${envelope.sender_name || 'PDI'}${envelope.sender_email ? ` · ${envelope.sender_email}` : ''}`

  if (finished) {
    return (
      <Shell title={envelope.title} subtitle={subtitle}>
        <Centered icon={CheckCircle2} tone="text-pdi-green" title="You're done — thank you!">
          <p>
            Your signature on <strong>{envelope.title}</strong> was recorded.
            {finished.completed
              ? ' Everyone has now signed; a sealed copy has been e-mailed to all parties.'
              : ' You will receive the completed copy by e-mail once everyone has signed.'}
          </p>
          {finished.completed && (
            <button onClick={async () => { await load(); setFinished(null) }} className="text-sm font-semibold text-pdi-navy hover:underline">
              View the signed document
            </button>
          )}
        </Centered>
      </Shell>
    )
  }

  return (
    <Shell title={envelope.title} subtitle={subtitle}>
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 pb-28 space-y-4">
        {/* Status / consent */}
        {!view.can_sign ? (
          <div className={`rounded-xl p-4 text-sm flex items-start gap-3 ${envelope.status === 'completed' ? 'bg-pdi-green-light text-pdi-green' : 'bg-white text-gray-700 border border-gray-200'}`}>
            {envelope.status === 'completed' ? <ShieldCheck size={18} className="flex-shrink-0" /> : <AlertTriangle size={18} className="flex-shrink-0 text-pdi-amber" />}
            <div className="flex-1">{view.reason}</div>
            {view.can_download && (
              <button onClick={download} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-pdi-navy text-white">
                {busy === 'download' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download
              </button>
            )}
          </div>
        ) : !consented ? (
          <div className="rounded-xl bg-white border border-gray-200 p-4 sm:p-5 space-y-3">
            <h1 className="text-base font-semibold text-pdi-navy">Hello {recipient.name}, please review and sign</h1>
            {envelope.message && <p className="text-sm text-gray-700 whitespace-pre-line bg-pdi-frost/50 rounded-lg p-3">{envelope.message}</p>}
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-1" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
              <span>
                I agree to use electronic records and signatures for this document. I understand my electronic signature is legally
                binding, just like a handwritten one, and that I may ask the sender for a paper copy instead.
              </span>
            </label>
            {actionError && <p className="text-sm text-pdi-red">{actionError}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={consent}
                disabled={!consentChecked || busy === 'consent'}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-pdi-amber text-white disabled:opacity-50"
              >
                {busy === 'consent' && <Loader2 size={15} className="animate-spin" />} Continue
              </button>
              <button onClick={() => setDeclining(true)} className="px-4 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Decline to sign</button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-white border border-gray-200 px-4 py-3 text-sm text-gray-700 flex items-center justify-between gap-3">
            <span>Fill in the highlighted fields{fields.some((f) => f.type === 'date') ? '; dates fill in automatically' : ''}.</span>
            <span className="text-xs text-gray-500 whitespace-nowrap">{required.length - remainingFields(required, values, marks).length}/{required.length} done</span>
          </div>
        )}

        {/* Document */}
        <PdfPages
          bytes={pdf}
          maxWidth={900}
          renderOverlay={(pageIndex, viewport) => (view.can_sign ? fields : []).filter((f) => f.page === pageIndex).map((f) => {
            const r = fieldToScreen(f, viewport)
            const done = fieldComplete(f, values, marks)
            const style = {
              left: r.left, top: r.top, width: r.width, height: r.height,
              border: `1.5px ${done ? 'solid' : 'dashed'} ${done ? '#1E7E4A' : '#D4943A'}`,
              background: done ? 'rgba(212, 237, 218, 0.35)' : 'rgba(245, 219, 168, 0.45)',
              borderRadius: 3,
            }
            const fontSize = Math.max(8, Math.min(14, r.height * 0.62))
            const disabled = !canEdit
            const label = f.label || FIELD_META[f.type]?.label

            if (f.type === 'signature' || f.type === 'initials') {
              const mark = marks[f.type]
              return (
                <button
                  key={f.id}
                  id={`field-${f.id}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => setPad(f.type)}
                  className="absolute flex items-center justify-center overflow-hidden disabled:cursor-not-allowed"
                  style={style}
                  title={label}
                  aria-label={mark ? `Change ${f.type}` : `Add ${f.type}`}
                >
                  {mark ? (
                    <img src={mark.image} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-pdi-amber px-1.5 py-0.5 font-semibold text-white" style={{ fontSize: Math.max(9, Math.min(12, r.height * 0.45)) }}>
                      <PenLine size={Math.max(9, Math.min(13, r.height * 0.45))} /> {f.type === 'initials' ? 'Initial' : 'Sign'}
                    </span>
                  )}
                </button>
              )
            }
            if (f.type === 'date') {
              return (
                <div key={f.id} id={`field-${f.id}`} className="absolute flex items-center px-1 text-gray-500" style={{ ...style, fontSize, border: '1.5px solid #1E7E4A' }} title="Filled in automatically when you finish">
                  {todayText()}
                </div>
              )
            }
            if (f.type === 'checkbox') {
              return (
                <label key={f.id} id={`field-${f.id}`} className="absolute flex items-center justify-center cursor-pointer" style={style} title={label}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={values[f.id] === true}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.checked }))}
                    className="h-[80%] w-[80%] max-h-5 max-w-5 accent-pdi-navy"
                    aria-label={label}
                  />
                </label>
              )
            }
            return (
              <input
                key={f.id}
                id={`field-${f.id}`}
                type={f.type === 'email' ? 'email' : 'text'}
                disabled={disabled}
                value={values[f.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                placeholder={label + (f.required ? '' : ' (optional)')}
                maxLength={f.type === 'text' ? 500 : 200}
                className="absolute px-1 text-pdi-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pdi-navy disabled:cursor-not-allowed"
                style={{ ...style, fontSize }}
                aria-label={label}
              />
            )
          })}
        />
      </div>

      {/* Action bar */}
      {view.can_sign && consented && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-2">
            <button onClick={() => setDeclining(true)} className="px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Decline</button>
            <div className="flex-1 text-center text-xs text-pdi-red truncate">{actionError}</div>
            {remaining.length > 0 && (
              <button onClick={goToNext} className="inline-flex items-center gap-1 px-3 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-pdi-navy">
                <ChevronDown size={15} /> Next field ({remaining.length})
              </button>
            )}
            <button
              onClick={finish}
              disabled={busy === 'sign' || remaining.length > 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-pdi-amber text-white disabled:opacity-50"
            >
              {busy === 'sign' && <Loader2 size={15} className="animate-spin" />} Finish
            </button>
          </div>
        </div>
      )}

      <SignaturePad
        open={!!pad}
        kind={pad || 'signature'}
        defaultText={pad === 'initials' ? initialsOf(recipient.name) : recipient.name}
        onClose={() => setPad(null)}
        onAdopt={(mark) => { setMarks((m) => ({ ...m, [pad]: mark })); setPad(null) }}
      />

      {declining && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDeclining(false)} />
          <form onSubmit={decline} className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3">
            <h2 className="text-base font-semibold text-pdi-navy flex items-center gap-2"><XCircle size={18} className="text-pdi-red" /> Decline to sign</h2>
            <p className="text-sm text-gray-600">The sender will be notified and the document will be closed for all signers.</p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              maxLength={1000}
              required
              placeholder="Reason"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
            {actionError && <p className="text-sm text-pdi-red">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeclining(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="submit" disabled={!declineReason.trim() || busy === 'decline'} className="px-4 py-2 rounded-lg text-sm font-semibold bg-pdi-red text-white disabled:opacity-40">
                Decline
              </button>
            </div>
          </form>
        </div>
      )}
    </Shell>
  )
}
