import { useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Download, Loader2, RefreshCw, Ban, Trash2, ShieldCheck, Copy, Mail, History,
  CheckCircle2, Clock, Eye, XCircle, Send, AlertTriangle, FileText,
} from 'lucide-react'
import {
  useEnvelope, useEnvelopePdf, useResendEnvelope, useVoidEnvelope, useFinalizeEnvelope,
  useDeleteEnvelope, downloadEnvelopeFile, esignError,
} from '../../hooks/useEsign'
import { useToast } from '../../hooks/useToast'
import { RECIPIENT_STATUS, recipientColor } from '../../lib/esign'
import { formatDateTime } from '../../lib/utils'
import EnvelopeStatusBadge from '../../components/esign/EnvelopeStatusBadge'
import PdfPages from '../../components/esign/PdfPages'

const EVENT_TEXT = {
  created: 'Envelope created',
  sent: 'Sent for signature',
  invited: 'Invitation e-mailed',
  resent: 'Invitation re-sent',
  viewed: 'Opened the document',
  consented: 'Agreed to sign electronically',
  signed: 'Signed',
  declined: 'Declined to sign',
  completed: 'Completed — all parties signed',
  sealed: 'Sealed with digital signature',
  not_sealed: 'Completed without a seal (no certificate configured)',
  voided: 'Voided',
  expired: 'Expired',
  email_failed: 'E-mail delivery failed',
  finalize_failed: 'Finishing the signed PDF failed',
}

const STATUS_ICON = { pending: Clock, sent: Mail, viewed: Eye, signed: CheckCircle2, declined: XCircle }

function CopyLink({ url }) {
  const { showToast } = useToast()
  const inputRef = useRef(null)
  return (
    <span className="flex items-center gap-2 min-w-0">
      <input
        ref={inputRef}
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        aria-label="Signing link"
        className="hidden sm:block w-56 min-w-0 rounded border border-amber-200 bg-amber-50/50 px-1.5 py-0.5 text-[11px] text-gray-600"
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            showToast('Link copied', 'success')
          } catch (_) {
            // Clipboard access can be blocked (non-HTTPS, browser policy); leave the text selected instead.
            inputRef.current?.classList.remove('hidden')
            inputRef.current?.focus()
            showToast('Press Ctrl+C to copy the selected link', 'info')
          }
        }}
        className="inline-flex items-center gap-1 text-xs font-semibold text-pdi-navy hover:underline whitespace-nowrap"
      >
        <Copy size={12} /> Copy link
      </button>
    </span>
  )
}

export default function EsignDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()
  const { data, isLoading, error } = useEnvelope(id)
  const env = data?.envelope
  const { data: pdfBytes } = useEnvelopePdf(id, 'current', { enabled: !!env, version: env?.updated_at })
  const resend = useResendEnvelope()
  const voidEnv = useVoidEnvelope()
  const finalize = useFinalizeEnvelope()
  const del = useDeleteEnvelope()
  const [links, setLinks] = useState(location.state?.links || [])
  const [voiding, setVoiding] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [busy, setBusy] = useState('')
  const [showDoc, setShowDoc] = useState(false)

  if (isLoading) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-500"><Loader2 size={18} className="animate-spin" /> Loading…</div>
  if (error || !env) return <div className="p-6 text-sm text-pdi-red">Could not open this envelope.</div>
  if (env.status === 'draft') return <Navigate to={`/esign/${id}/edit`} replace />

  const recipients = data.recipients
  const allSigned = recipients.length > 0 && recipients.every((r) => r.status === 'signed')
  const nameOf = (rid) => recipients.find((r) => r.id === rid)?.name

  async function run(key, fn, success) {
    setBusy(key)
    try {
      const out = await fn()
      if (success) showToast(success, 'success')
      return out
    } catch (err) {
      showToast(await esignError(err), 'error')
      return null
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
        <button onClick={() => navigate('/esign')} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-pdi-navy">
          <ArrowLeft size={15} /> E-Sign
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy break-all">{env.title}</h1>
          <EnvelopeStatusBadge status={env.status} />
          {env.sealed && <span className="inline-flex items-center gap-1 text-xs font-semibold text-pdi-green"><ShieldCheck size={14} /> Sealed</span>}
        </div>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
          {env.original_name} · sent {formatDateTime(env.sent_at)}
          {env.status === 'sent' && env.expires_at && <> · expires {formatDateTime(env.expires_at)}</>}
          {env.completed_at && <> · completed {formatDateTime(env.completed_at)}</>}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {env.status === 'completed' && (
            <button
              onClick={() => run('dl', () => downloadEnvelopeFile(id, 'signed', `${env.title} - signed.pdf`))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-pdi-navy text-white hover:bg-pdi-navy-light"
            >
              {busy === 'dl' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Signed PDF
            </button>
          )}
          <button
            onClick={() => run('orig', () => downloadEnvelopeFile(id, 'original', env.original_name))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            <FileText size={15} /> Original
          </button>
          {env.status === 'sent' && (
            <>
              <button
                onClick={() => run('resend', async () => {
                  const out = await resend.mutateAsync({ id })
                  if (out?.links?.length) setLinks(out.links)
                }, 'Invitation re-sent')}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                {busy === 'resend' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Remind
              </button>
              <button
                onClick={() => setVoiding(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-red-200 text-pdi-red hover:bg-red-50"
              >
                <Ban size={15} /> Void
              </button>
            </>
          )}
          {env.status === 'sent' && allSigned && (
            <button
              onClick={() => run('fin', () => finalize.mutateAsync({ id }), 'Signed PDF finished')}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-pdi-amber text-white disabled:opacity-40"
            >
              {busy === 'fin' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Retry finishing
            </button>
          )}
          {['voided', 'declined', 'expired'].includes(env.status) && (
            <button
              onClick={async () => {
                if (!window.confirm('Delete this envelope and its files permanently?')) return
                const ok = await run('del', () => del.mutateAsync(id), 'Envelope deleted')
                if (ok) navigate('/esign', { replace: true })
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-500 hover:text-pdi-red"
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-w-6xl">
        <div className="space-y-4">
          {links.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-amber-800"><AlertTriangle size={15} /> Share these links</div>
              <p className="mt-1 text-xs text-amber-800">
                {links.some((l) => l.error) ? 'Some invitations could not be e-mailed.' : 'E-mail is not configured on this server, so no invitations were sent.'}
                {' '}Send each signer their own link.
              </p>
              <ul className="mt-2 space-y-1.5">
                {links.map((l) => (
                  <li key={l.recipient_id} className="flex items-center justify-between gap-2 bg-white rounded-md px-2.5 py-1.5 border border-amber-200">
                    <span className="min-w-0 truncate text-xs"><strong>{l.name}</strong> · {l.email}</span>
                    <CopyLink url={l.url} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {env.status === 'voided' && (
            <div className="rounded-xl bg-gray-100 p-4 text-sm text-gray-700">Voided {formatDateTime(env.voided_at)}: {env.void_reason}</div>
          )}
          {env.status === 'declined' && (
            <div className="rounded-xl bg-pdi-red-light p-4 text-sm text-pdi-red">
              Declined by {recipients.find((r) => r.status === 'declined')?.name}: {recipients.find((r) => r.status === 'declined')?.decline_reason}
            </div>
          )}

          <section className="bg-white rounded-xl border border-gray-200">
            <h2 className="px-4 py-3 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Recipients · {env.routing === 'parallel' ? 'all at once' : 'in order'}
            </h2>
            <ul className="divide-y divide-gray-100">
              {recipients.map((r, i) => {
                const s = RECIPIENT_STATUS[r.status] || { label: r.status, cls: 'text-gray-500' }
                const Icon = STATUS_ICON[r.status] || Clock
                return (
                  <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                    <span className="mt-1 h-3 w-3 rounded-full flex-shrink-0" style={{ background: recipientColor(i).border }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-pdi-navy">{r.name}</span>
                        {r.role_label && <span className="text-xs text-gray-400">{r.role_label}</span>}
                        {env.routing === 'sequential' && <span className="text-[11px] text-gray-400">#{r.routing_order}</span>}
                        {r.auth_method === 'account' && <span className="text-[11px] rounded bg-pdi-frost px-1.5 text-pdi-navy">PDI sign-in</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{r.email}</div>
                      <div className="mt-1 text-[11px] text-gray-400 space-x-2">
                        {r.viewed_at && <span>viewed {formatDateTime(r.viewed_at)}</span>}
                        {r.signed_at && <span>signed {formatDateTime(r.signed_at)}{r.signer_ip ? ` from ${r.signer_ip}` : ''}</span>}
                        {r.declined_at && <span>declined {formatDateTime(r.declined_at)}</span>}
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${s.cls}`}><Icon size={13} /> {s.label}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="bg-white rounded-xl border border-gray-200">
            <h2 className="px-4 py-3 border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
              <History size={13} /> History
            </h2>
            <ol className="px-4 py-3 space-y-2.5">
              {data.audit.map((a) => (
                <li key={a.id} className="text-xs">
                  <div className="text-gray-800">
                    <span className="font-semibold">{EVENT_TEXT[a.event] || a.event}</span>
                    {(a.actor || nameOf(a.recipient_id)) && <span className="text-gray-500"> — {a.actor || nameOf(a.recipient_id)}</span>}
                    {a.detail?.reason && <span className="text-gray-500">: {a.detail.reason}</span>}
                    {a.detail?.to && a.event !== 'signed' && <span className="text-gray-500"> ({a.detail.to})</span>}
                    {a.event === 'signed' && a.detail?.method && <span className="text-gray-500"> · {a.detail.method === 'typed' ? `typed "${a.detail.typed}"` : 'drawn'}</span>}
                    {a.detail?.error && <span className="text-pdi-red"> — {a.detail.error}</span>}
                  </div>
                  <div className="text-gray-400">{formatDateTime(a.created_at)}{a.ip ? ` · ${a.ip}` : ''}</div>
                </li>
              ))}
            </ol>
          </section>

          {env.signed_sha256 && (
            <p className="text-[11px] text-gray-400 break-all">Signed file SHA-256: {env.signed_sha256}</p>
          )}
        </div>

        <section className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {env.status === 'completed' ? 'Signed document' : 'Current document'}
            </h2>
            <button onClick={() => setShowDoc((v) => !v)} className="text-xs font-semibold text-pdi-navy hover:underline lg:hidden">
              {showDoc ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className={`${showDoc ? 'block' : 'hidden'} lg:block`}>
            <PdfPages bytes={pdfBytes} maxWidth={640} />
          </div>
        </section>
      </div>

      {voiding && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setVoiding(false)} />
          <form
            className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              const ok = await run('void', () => voidEnv.mutateAsync({ id, reason: voidReason }), 'Envelope voided')
              if (ok) setVoiding(false)
            }}
          >
            <h2 className="text-base font-semibold text-pdi-navy">Void this envelope?</h2>
            <p className="text-sm text-gray-600">Signers who have not signed are told it no longer needs their signature, and their links stop working.</p>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason (shown to the signers)"
              rows={3}
              required
              maxLength={1000}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVoiding(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="submit" disabled={!voidReason.trim() || busy === 'void'} className="px-4 py-2 rounded-lg text-sm font-semibold bg-pdi-red text-white disabled:opacity-40">
                Void envelope
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
