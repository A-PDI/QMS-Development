import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { chooseSaveTarget, writeBlobToTarget } from '../lib/download'
import { ncrPdfFilename } from '../lib/ncrReport'

export function useNCRs(filters = {}, options = {}) {
  const safeFilters = filters || {}
  return useQuery({
    queryKey: ['ncrs', safeFilters],
    queryFn: async () => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(safeFilters)) {
        if (v !== undefined && v !== '' && v !== null) params.set(k, v)
      }
      const { data } = await api.get(`/ncrs?${params}`)
      return data
    },
    enabled: options.enabled !== false,
  })
}

export function useNCR(id) {
  return useQuery({
    queryKey: ['ncr', id],
    queryFn: async () => {
      const { data } = await api.get(`/ncrs/${id}`)
      return data.ncr
    },
    enabled: !!id,
  })
}

export function useCreateNCR() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data } = await api.post('/ncrs', body)
      return data.ncr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ncrs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateNCR() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }) => {
      const { data } = await api.patch(`/ncrs/${id}`, body)
      return data.ncr
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['ncr', id] })
      qc.invalidateQueries({ queryKey: ['ncrs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteNCR() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.delete(`/ncrs/${id}`)
      return data
    },
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: ['ncr', id] })
      qc.invalidateQueries({ queryKey: ['ncrs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/** Save the section layout, photo placement and captions of an NCR. */
export function useSaveNCRContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }) => {
      const { data } = await api.put(`/ncrs/${id}/content`, payload)
      return data
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['ncr', id] })
    },
  })
}

/** Upload one JPEG / PNG photo to an NCR; returns the stored image row. */
export async function uploadNCRImage(ncrId, file, caption = '') {
  const form = new FormData()
  form.append('file', file)
  if (caption) form.append('caption', caption)
  const { data } = await api.post(`/ncrs/${ncrId}/images`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.image
}

/** API path that streams one NCR photo (for AuthImage). */
export function ncrImagePath(imageId) {
  return `/ncrs/images/${imageId}`
}

/**
 * Ask where to save, then generate and save the NCR's PDF. Must be called
 * straight from a click handler (see lib/download.js). Returns false when the
 * user cancelled, true once saved; throws on failure.
 */
export async function downloadNCRPdf(ncr) {
  const target = await chooseSaveTarget(ncrPdfFilename(ncr), { promptMessage: 'File name for the NCR report' })
  if (target.cancelled) return false
  const { data } = await api.get(`/ncrs/${ncr.id}/pdf`, { responseType: 'blob' })
  await writeBlobToTarget(target, data)
  return true
}

/** Readable message from an API error, including JSON errors on blob requests. */
export async function apiErrorMessage(err, fallback) {
  const data = err?.response?.data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      if (parsed?.error) return parsed.error
    } catch (_) { /* not JSON */ }
  }
  return data?.error || err?.message || fallback
}
