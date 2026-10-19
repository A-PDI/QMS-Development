import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import api from '../lib/api'
import { getToken } from '../lib/auth'
import { safeFilename } from '../lib/esign'

/** Error text from an API failure (JSON body, Blob body or network error). */
export async function esignError(err, fallback = 'Something went wrong') {
  const data = err?.response?.data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      if (parsed?.error) return parsed.error
    } catch (_) { /* not JSON */ }
  }
  if (data instanceof ArrayBuffer) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data))
      if (parsed?.error) return parsed.error
    } catch (_) { /* not JSON */ }
  }
  return data?.error || err?.message || fallback
}

// ── Sender side (/api/esign, signed in) ──────────────────────────────────────

export function useEnvelopes(filters = {}) {
  return useQuery({
    queryKey: ['esign', 'list', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== '') params.set(k, v)
      }
      const { data } = await api.get(`/esign?${params}`)
      return data
    },
  })
}

export function useEnvelope(id, { pollWhileDetecting = false } = {}) {
  return useQuery({
    queryKey: ['esign', 'envelope', id],
    queryFn: async () => (await api.get(`/esign/${id}`)).data,
    enabled: !!id,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (
      pollWhileDetecting && query.state.data?.envelope?.detection_status === 'pending' ? 1500 : false
    ),
  })
}

/** Raw bytes of an envelope PDF (original | current | signed). */
export function useEnvelopePdf(id, kind = 'original', { enabled = true, version } = {}) {
  return useQuery({
    queryKey: ['esign', 'pdf', id, kind, version],
    queryFn: async () => (await api.get(`/esign/${id}/file/${kind}`, { responseType: 'arraybuffer' })).data,
    enabled: !!id && enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useEsignInbox() {
  return useQuery({
    queryKey: ['esign', 'inbox'],
    queryFn: async () => (await api.get('/esign/inbox')).data.items,
    refetchInterval: 60000,
  })
}

function invalidate(qc, id) {
  qc.invalidateQueries({ queryKey: ['esign', 'list'] })
  if (id) qc.invalidateQueries({ queryKey: ['esign', 'envelope', id] })
}

export function useCreateEnvelope() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, title, message, routing }) => {
      const form = new FormData()
      form.append('file', file)
      if (title) form.append('title', title)
      if (message) form.append('message', message)
      if (routing) form.append('routing', routing)
      const { data } = await api.post('/esign', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      return data.envelope
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Save the whole draft: meta, then recipients, then fields (fields reference recipient ids). */
export function useSaveDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, meta, recipients, fields }) => {
      if (meta) await api.patch(`/esign/${id}`, meta)
      const saved = (await api.put(`/esign/${id}/recipients`, { recipients })).data.recipients
      // New recipients carry temporary ids in the editor; the server returns
      // them in the same order with real ids.
      const idMap = new Map(recipients.map((r, i) => [r.id, saved[i]?.id]))
      const mapped = fields.map((f) => ({ ...f, recipient_id: f.recipient_id ? (idMap.get(f.recipient_id) || null) : null }))
      await api.put(`/esign/${id}/fields`, { fields: mapped })
      return (await api.get(`/esign/${id}`)).data
    },
    onSuccess: (data, { id }) => {
      qc.setQueryData(['esign', 'envelope', id], data)
      invalidate(qc)
    },
  })
}

function action(path, method = 'post') {
  return function useAction() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: async ({ id, ...body }) => (await api[method](`/esign/${id}${path}`, body)).data,
      onSuccess: (_, { id }) => invalidate(qc, id),
    })
  }
}

export const useRedetect = action('/detect')
export const useSendEnvelope = action('/send')
export const useResendEnvelope = action('/resend')
export const useVoidEnvelope = action('/void')
export const useFinalizeEnvelope = action('/finalize')

export function useDeleteEnvelope() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => (await api.delete(`/esign/${id}`)).data,
    onSuccess: () => invalidate(qc),
  })
}

export async function startInboxSigning(recipientId) {
  return (await api.post(`/esign/inbox/${recipientId}/start`)).data.path
}

export async function downloadEnvelopeFile(id, kind, filename) {
  const { data } = await api.get(`/esign/${id}/file/${kind}`, { params: { download: 1 }, responseType: 'blob' })
  saveBlob(data, filename)
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFilename(filename)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Signer side (/api/esign/public, no login) ────────────────────────────────

/**
 * A separate axios instance for the signing page: it sends the app token when
 * there is one (for recipients who must be signed in) but, unlike lib/api.js,
 * a 401 here must NOT log the user out and bounce them to /login — the page
 * shows its own "sign in to continue" message instead.
 */
export const signApi = axios.create({ baseURL: '/api/esign/public' })
signApi.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
