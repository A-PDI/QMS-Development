import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Save, Send, Wand2, ScanSearch, Plus, Trash2, UserPlus, Users,
  AlertTriangle, CheckCircle2, X, PanelLeftOpen, PanelLeftClose,
} from 'lucide-react'
import {
  useEnvelope, useEnvelopePdf, useSaveDraft, useRedetect, useSendEnvelope, useDeleteEnvelope, esignError,
} from '../../hooks/useEsign'
import { useToast } from '../../hooks/useToast'
import { getUser } from '../../lib/auth'
import {
  FIELD_TYPES, FIELD_META, recipientColor, fieldToScreen, screenToField, clampToPage, newFieldBox,
  autoAssignFields, sendProblems, isEmail,
} from '../../lib/esign'
import PdfPages from '../../components/esign/PdfPages'
import FieldBox from '../../components/esign/FieldBox'
import EnvelopeStatusBadge from '../../components/esign/EnvelopeStatusBadge'

let tmpCounter = 0
const tmpId = (prefix) => `tmp-${prefix}-${Date.now().toString(36)}-${(tmpCounter++).toString(36)}`

const FIELD_KEYS = ['page', 'x', 'y', 'width', 'height', 'type', 'label', 'required', 'source', 'role_hint', 'recipient_index', 'confidence', 'recipient_id']

function fromServer(detail) {
  return {
    title: detail.envelope.title,
    message: detail.envelope.message || '',
    routing: detail.envelope.routing,
    recipients: detail.recipients.map((r) => ({
      id: r.id, name: r.name, email: r.email, role_label: r.role_label || '',
      routing_order: r.routing_order, auth_method: r.auth_method,
    })),
    fields: detail.fields.map((f) => ({ ...f, required: f.required !== false })),
  }
}

export default function EsignEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const me = getUser()

  const { data: detail, isLoading, error } = useEnvelope(id, { pollWhileDetecting: true })
  const { data: pdfBytes } = useEnvelopePdf(id, 'original')
  const saveDraft = useSaveDraft()
  const redetect = useRedetect()
  const sendEnvelope = useSendEnvelope()
  const deleteEnvelope = useDeleteEnvelope()

  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [activeRecipient, setActiveRecipient] = useState(null)
  const [placeType, setPlaceType] = useState(null)
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640)
  const [confirmSend, setConfirmSend] = useState(false)
  const [problems, setProblems] = useState([])
  const [busy, setBusy] = useState('')
  const lastDetection = useRef(null)
  // While sending, doSend navigates (with the signing links); the effect below must not race it.
  const sendingRef = useRef(false)

  // Load (and, while untouched, refresh) the local draft from the server —
  // e.g. when field detection finishes a few seconds after upload.
  useEffect(() => {
    if (!detail || sendingRef.current) return
    if (detail.envelope.status !== 'draft') {
      navigate(`/esign/${id}`, { replace: true })
      return
    }
    const detectionChanged = lastDetection.current !== detail.envelope.detection_status
    lastDetection.current = detail.envelope.detection_status
    if (!draft || (!dirty && detectionChanged) || (!dirty && !draft)) {
      const next = fromServer(detail)
      setDraft(next)
      setActiveRecipient((cur) => (cur && next.recipients.some((r) => r.id === cur) ? cur : next.recipients[0]?.id || null))
    }
  }, [detail]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const pages = detail?.envelope.pages || []
  const recipients = draft?.recipients || []
  const fields = draft?.fields || []
  const recipientIndex = useMemo(() => new Map(recipients.map((r, i) => [r.id, i])), [recipients])
  const selected = fields.find((f) => f.id === selectedId) || null

  const update = useCallback((fn) => {
    setDraft((d) => fn(d))
    setDirty(true)
  }, [])

  const updateField = useCallback((fid, patch) => {
    update((d) => ({ ...d, fields: d.fields.map((f) => (f.id === fid ? { ...f, ...patch } : f)) }))
  }, [update])

  const removeField = useCallback((fid) => {
    update((d) => ({ ...d, fields: d.fields.filter((f) => f.id !== fid) }))
    setSelectedId(null)
  }, [update])

  // Keyboard: Delete removes the selected field; Escape cancels placing/selection.
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (['input', 'textarea', 'select'].includes(tag)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); removeField(selectedId) }
      if (e.key === 'Escape') { setPlaceType(null); setSelectedId(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, removeField])

  // ── Recipients ──
  function addRecipient(preset = {}) {
    const rid = tmpId('r')
    update((d) => ({
      ...d,
      recipients: [...d.recipients, {
        id: rid, name: '', email: '', role_label: '', auth_method: 'link',
        routing_order: d.recipients.length + 1, ...preset,
      }],
    }))
    setActiveRecipient(rid)
  }

  function updateRecipient(rid, patch) {
    update((d) => ({ ...d, recipients: d.recipients.map((r) => (r.id === rid ? { ...r, ...patch } : r)) }))
  }

  function removeRecipient(rid) {
    update((d) => ({
      ...d,
      recipients: d.recipients.filter((r) => r.id !== rid),
      fields: d.fields.map((f) => (f.recipient_id === rid ? { ...f, recipient_id: null } : f)),
    }))
    if (activeRecipient === rid) setActiveRecipient(null)
  }

  // ── Fields ──
  function placeAt(pageIndex, viewport, e) {
    if (!placeType) { setSelectedId(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const [px, py] = viewport.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top)
    const box = newFieldBox(placeType, { x: px, y: py }, pages[pageIndex])
    const fid = tmpId('f')
    update((d) => ({
      ...d,
      fields: [...d.fields, {
        id: fid, page: pageIndex, ...box, type: placeType, label: FIELD_META[placeType].label,
        required: placeType !== 'checkbox', source: 'manual', role_hint: null, recipient_index: null,
        confidence: null, recipient_id: activeRecipient || null,
      }],
    }))
    setSelectedId(fid)
    setPlaceType(null)
  }

  function commitBox(field, viewport, rect) {
    const box = clampToPage(screenToField(rect, viewport), pages[field.page])
    updateField(field.id, box)
  }

  function autoAssign() {
    const before = fields.filter((f) => !f.recipient_id).length
    const next = autoAssignFields(fields, recipients)
    const after = next.filter((f) => !f.recipient_id).length
    update((d) => ({ ...d, fields: next }))
    showToast(before === after ? 'Nothing to auto-assign — assign the remaining fields by hand' : `Assigned ${before - after} field${before - after === 1 ? '' : 's'}`)
  }

  function assignRemainingTo(recipientId) {
    if (!recipientId) return
    update((d) => ({ ...d, fields: d.fields.map((f) => (f.recipient_id ? f : { ...f, recipient_id: recipientId })) }))
  }

  // ── Save / send ──
  async function save({ quiet = false } = {}) {
    for (const r of recipients) {
      if (r.email && !isEmail(r.email)) { showToast(`"${r.email}" is not a valid e-mail address`, 'error'); return null }
    }
    setBusy('save')
    try {
      const payload = {
        id,
        meta: { title: draft.title.trim() || 'Untitled document', message: draft.message, routing: draft.routing },
        recipients: recipients
          .filter((r) => r.name.trim() || r.email.trim())
          .map((r, i) => ({
            id: r.id, name: r.name.trim(), email: r.email.trim(), role_label: r.role_label.trim() || null,
            routing_order: draft.routing === 'parallel' ? 1 : (parseInt(r.routing_order, 10) || i + 1),
            auth_method: r.auth_method,
          })),
        fields: fields.map((f) => Object.fromEntries(FIELD_KEYS.map((k) => [k, f[k] ?? null]))),
      }
      const saved = await saveDraft.mutateAsync(payload)
      const next = fromServer(saved)
      setDraft(next)
      setDirty(false)
      setSelectedId(null)
      setActiveRecipient((cur) => {
        const idx = recipients.findIndex((r) => r.id === cur)
        return next.recipients[idx]?.id || next.recipients[0]?.id || null
      })
      if (!quiet) showToast('Draft saved', 'success')
      return saved
    } catch (err) {
      showToast(await esignError(err, 'Could not save'), 'error')
      return null
    } finally {
      setBusy('')
    }
  }

  async function runRedetect() {
    if (!window.confirm('Replace the detected fields with a fresh detection? Fields you added by hand are kept.')) return
    if (dirty && !(await save({ quiet: true }))) return
    setBusy('detect')
    try {
      await redetect.mutateAsync({ id })
      setDirty(false)
      setDraft(null) // reload from the refreshed query
    } catch (err) {
      showToast(await esignError(err, 'Detection failed'), 'error')
    } finally {
      setBusy('')
    }
  }

  function trySend() {
    const p = sendProblems(recipients, fields)
    setProblems(p)
    if (!p.length) setConfirmSend(true)
  }

  async function doSend() {
    setConfirmSend(false)
    const saved = await save({ quiet: true })
    if (!saved) return
    setBusy('send')
    sendingRef.current = true
    try {
      const result = await sendEnvelope.mutateAsync({ id })
      showToast('Sent for signature', 'success')
      navigate(`/esign/${id}`, { state: { links: result.links || [], mailMode: result.mail_mode } })
    } catch (err) {
      sendingRef.current = false
      showToast(await esignError(err, 'Could not send'), 'error')
    } finally {
      setBusy('')
    }
  }

  async function discard() {
    if (!window.confirm('Delete this draft and its PDF?')) return
    try {
      await deleteEnvelope.mutateAsync(id)
      navigate('/esign', { replace: true })
    } catch (err) {
      showToast(await esignError(err, 'Could not delete'), 'error')
    }
  }

  if (isLoading || (!draft && !error)) {
    return <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-500"><Loader2 size={18} className="animate-spin" /> Loading…</div>
  }
  if (error) {
    return <div className="p-6 text-sm text-pdi-red">Could not open this envelope.</div>
  }

  const env = detail.envelope
  const detecting = env.detection_status === 'pending'
  const unassignedCount = fields.filter((f) => !f.recipient_id).length
  const activeR = recipients.find((r) => r.id === activeRecipient)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-5 py-2.5 flex items-center gap-2 flex-shrink-0">
        <button onClick={() => navigate('/esign')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Back to e-sign">
          <ArrowLeft size={18} />
        </button>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 lg:hidden"
          aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
        >
          {panelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <input
          value={draft.title}
          onChange={(e) => update((d) => ({ ...d, title: e.target.value }))}
          maxLength={200}
          className="min-w-0 flex-1 text-base sm:text-lg font-semibold text-pdi-navy bg-transparent border border-transparent hover:border-gray-200 focus:border-pdi-navy rounded-md px-2 py-1 focus:outline-none"
          aria-label="Document title"
        />
        <EnvelopeStatusBadge status={env.status} className="hidden sm:inline-flex" />
        <span className="hidden md:inline text-xs text-gray-400 w-24 text-right">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <button
          onClick={() => save()}
          disabled={!!busy || !dirty}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          <span className="hidden sm:inline">Save</span>
        </button>
        <button
          onClick={trySend}
          disabled={!!busy || detecting}
          className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold bg-pdi-amber text-white hover:brightness-95 disabled:opacity-50"
        >
          {busy === 'send' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          Send
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Side panel */}
        {/* On phones the panel and the document take turns; from lg up both show. */}
        <aside className={`${panelOpen ? 'block' : 'hidden'} lg:block w-full sm:w-80 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto`}>
            <div className="p-4 space-y-5">
              {/* Detection */}
              <section className={`rounded-lg p-3 text-xs ${detecting ? 'bg-blue-50 text-blue-800' : env.detection_status === 'failed' ? 'bg-amber-50 text-amber-800' : 'bg-pdi-frost/60 text-pdi-charcoal'}`}>
                {detecting ? (
                  <div className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Detecting signature fields…</div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-start gap-1.5">
                      {env.detection_status === 'failed' ? <AlertTriangle size={14} className="flex-shrink-0 mt-px" /> : <ScanSearch size={14} className="flex-shrink-0 mt-px" />}
                      {env.detection_note || 'Fields detected.'}
                    </span>
                    <button onClick={runRedetect} disabled={!!busy} className="font-semibold text-pdi-navy hover:underline whitespace-nowrap disabled:opacity-40">
                      {busy === 'detect' ? 'Detecting…' : 'Re-detect'}
                    </button>
                  </div>
                )}
              </section>

              {/* Recipients */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><Users size={13} /> Recipients</h2>
                  <select
                    value={draft.routing}
                    onChange={(e) => update((d) => ({ ...d, routing: e.target.value }))}
                    className="text-xs border border-gray-200 rounded-md px-1.5 py-1"
                    aria-label="Signing order"
                  >
                    <option value="sequential">In order</option>
                    <option value="parallel">All at once</option>
                  </select>
                </div>
                <div className="space-y-2">
                  {recipients.map((r, i) => {
                    const c = recipientColor(i)
                    const active = r.id === activeRecipient
                    return (
                      <div
                        key={r.id}
                        onClick={() => setActiveRecipient(r.id)}
                        className={`rounded-lg border p-2.5 space-y-1.5 cursor-pointer ${active ? 'ring-2' : ''}`}
                        style={{ borderColor: c.border, ...(active ? { '--tw-ring-color': c.fill } : {}) , background: active ? c.fill : undefined }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: c.border }} />
                          {draft.routing === 'sequential' && (
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={r.routing_order}
                              onChange={(e) => updateRecipient(r.id, { routing_order: e.target.value })}
                              className="w-11 text-xs border border-gray-200 rounded px-1 py-0.5"
                              aria-label="Signing order"
                              title="Signing order"
                            />
                          )}
                          <input
                            value={r.name}
                            onChange={(e) => updateRecipient(r.id, { name: e.target.value })}
                            placeholder="Full name"
                            className="min-w-0 flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white"
                          />
                          <button onClick={(e) => { e.stopPropagation(); removeRecipient(r.id) }} className="p-1 text-gray-400 hover:text-pdi-red" aria-label="Remove recipient">
                            <X size={14} />
                          </button>
                        </div>
                        <input
                          value={r.email}
                          onChange={(e) => updateRecipient(r.id, { email: e.target.value })}
                          placeholder="E-mail"
                          type="email"
                          className={`w-full text-sm border rounded px-2 py-1 bg-white ${r.email && !isEmail(r.email) ? 'border-pdi-red' : 'border-gray-200'}`}
                        />
                        <div className="flex items-center gap-2">
                          <input
                            value={r.role_label}
                            onChange={(e) => updateRecipient(r.id, { role_label: e.target.value })}
                            placeholder="Role (e.g. Supplier)"
                            className="min-w-0 flex-1 text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                          />
                          <label className="flex items-center gap-1 text-[11px] text-gray-600 whitespace-nowrap" title="The signer must also sign in to this app with their Microsoft work account">
                            <input
                              type="checkbox"
                              checked={r.auth_method === 'account'}
                              onChange={(e) => updateRecipient(r.id, { auth_method: e.target.checked ? 'account' : 'link' })}
                            />
                            PDI sign-in
                          </label>
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {fields.filter((f) => f.recipient_id === r.id).length} field(s)
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => addRecipient()} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-600 hover:border-pdi-navy hover:text-pdi-navy">
                    <UserPlus size={14} /> Add recipient
                  </button>
                  {me && !recipients.some((r) => r.email.toLowerCase() === (me.email || '').toLowerCase()) && (
                    <button
                      onClick={() => addRecipient({ name: me.name || '', email: me.email || '', role_label: 'PDI', auth_method: 'account' })}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-2 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <Plus size={13} /> Me
                    </button>
                  )}
                </div>
              </section>

              {/* Palette */}
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Add a field</h2>
                <div className="grid grid-cols-3 gap-1.5">
                  {FIELD_TYPES.map((t) => (
                    <button
                      key={t.type}
                      onClick={() => setPlaceType(placeType === t.type ? null : t.type)}
                      className={`rounded-md border px-1.5 py-2 text-[11px] font-medium transition-colors ${
                        placeType === t.type ? 'border-pdi-navy bg-pdi-navy text-white' : 'border-gray-200 text-gray-700 hover:border-pdi-navy'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  {placeType
                    ? <>Click on the page to place it{activeR ? <> for <strong>{activeR.name || activeR.email || 'the selected recipient'}</strong></> : ' (unassigned)'}. Esc cancels.</>
                    : 'Pick a type, then click on the page. Drag fields to move them; drag the corner to resize.'}
                </p>
              </section>

              {/* Selected field */}
              {selected && (
                <section className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected field</h2>
                    <button onClick={() => removeField(selected.id)} className="inline-flex items-center gap-1 text-xs text-pdi-red hover:underline">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                  <label className="block text-xs text-gray-600">Type
                    <select
                      value={selected.type}
                      onChange={(e) => updateField(selected.id, { type: e.target.value })}
                      className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
                    >
                      {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-gray-600">Signer
                    <select
                      value={selected.recipient_id || ''}
                      onChange={(e) => updateField(selected.id, { recipient_id: e.target.value || null })}
                      className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
                    >
                      <option value="">— Unassigned —</option>
                      {recipients.map((r, i) => <option key={r.id} value={r.id}>{r.name || r.email || `Recipient ${i + 1}`}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-gray-600">Label shown to the signer
                    <input
                      value={selected.label || ''}
                      onChange={(e) => updateField(selected.id, { label: e.target.value })}
                      maxLength={200}
                      className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
                    />
                  </label>
                  {!['signature', 'initials', 'date'].includes(selected.type) && (
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={selected.required !== false} onChange={(e) => updateField(selected.id, { required: e.target.checked })} />
                      Required
                    </label>
                  )}
                  {selected.source !== 'manual' && (
                    <p className="text-[11px] text-gray-400">
                      {selected.source === 'ml' ? 'Detected by the model' : selected.source === 'tag' ? 'From a {{tag}} in the document' : 'From a form field in the PDF'}
                      {typeof selected.confidence === 'number' ? ` · ${Math.round(selected.confidence * 100)}% confidence` : ''}
                    </p>
                  )}
                </section>
              )}

              {/* Summary */}
              <section className="text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">{fields.length} field{fields.length === 1 ? '' : 's'}</span>
                  {recipients.length > 0 && unassignedCount > 0 && (
                    <button onClick={autoAssign} className="inline-flex items-center gap-1 font-semibold text-pdi-navy hover:underline">
                      <Wand2 size={12} /> Auto-assign
                    </button>
                  )}
                </div>
                {unassignedCount > 0 ? (
                  <div className="flex items-start gap-1.5 text-amber-700">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-px" />
                    {unassignedCount} field{unassignedCount === 1 ? '' : 's'} not assigned (dashed outline).
                  </div>
                ) : fields.length > 0 && (
                  <div className="flex items-center gap-1.5 text-pdi-green"><CheckCircle2 size={13} /> Every field has a signer.</div>
                )}
                {unassignedCount > 0 && recipients.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => assignRemainingTo(e.target.value)}
                    aria-label="Assign the remaining fields"
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-700"
                  >
                    <option value="">Assign the rest to…</option>
                    {recipients.map((r, i) => (
                      <option key={r.id} value={r.id}>{r.name || r.email || `Recipient ${i + 1}`}</option>
                    ))}
                  </select>
                )}
              </section>

              {problems.length > 0 && (
                <section className="rounded-lg bg-pdi-red-light p-3 text-xs text-pdi-red space-y-1">
                  <div className="font-semibold">Before sending:</div>
                  {problems.map((p) => <div key={p}>• {p}</div>)}
                </section>
              )}

              <section className="pt-2 border-t border-gray-100">
                <label className="block text-xs text-gray-600">Message to signers
                  <textarea
                    value={draft.message}
                    onChange={(e) => update((d) => ({ ...d, message: e.target.value }))}
                    rows={3}
                    maxLength={2000}
                    className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
                  />
                </label>
                <button onClick={discard} className="mt-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-pdi-red">
                  <Trash2 size={12} /> Delete draft
                </button>
              </section>
            </div>
        </aside>

        {/* Document */}
        <main className={`${panelOpen ? 'hidden sm:block' : 'block'} flex-1 min-w-0 overflow-auto bg-gray-100 p-3 sm:p-6`}>
          {placeType && (
            <div className="sticky top-0 z-40 mx-auto mb-3 w-fit rounded-full bg-pdi-navy px-4 py-1.5 text-xs text-white shadow">
              Click to place a {FIELD_META[placeType].label.toLowerCase()} field · Esc to cancel
            </div>
          )}
          <PdfPages
            bytes={pdfBytes}
            cursor={placeType ? 'crosshair' : undefined}
            onPageClick={placeAt}
            renderOverlay={(pageIndex, viewport) => fields.filter((f) => f.page === pageIndex).map((f) => {
              const idx = f.recipient_id ? recipientIndex.get(f.recipient_id) : -1
              const r = f.recipient_id ? recipients[idx] : null
              return (
                <FieldBox
                  key={f.id}
                  field={f}
                  rect={fieldToScreen(f, viewport)}
                  bounds={{ width: viewport.width, height: viewport.height }}
                  color={recipientColor(idx ?? -1)}
                  selected={f.id === selectedId}
                  recipientName={r ? (r.name || r.email) : null}
                  onSelect={() => setSelectedId(f.id)}
                  onCommit={(rect) => commitBox(f, viewport, rect)}
                />
              )
            })}
          />
        </main>
      </div>

      {confirmSend && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setConfirmSend(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3">
            <h2 className="text-base font-semibold text-pdi-navy">Send for signature?</h2>
            <p className="text-sm text-gray-600">
              {draft.routing === 'parallel'
                ? `All ${recipients.length} recipient${recipients.length === 1 ? '' : 's'} will be e-mailed now.`
                : `${recipients.filter((r) => Number(r.routing_order) === Math.min(...recipients.map((x) => Number(x.routing_order) || 1))).map((r) => r.name).join(', ')} will be e-mailed first; the others when it is their turn.`}
              {' '}The document can no longer be edited after sending.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setConfirmSend(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={doSend} className="px-4 py-2 rounded-lg text-sm font-semibold bg-pdi-amber text-white hover:brightness-95">Send now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
