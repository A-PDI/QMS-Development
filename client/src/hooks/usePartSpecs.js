import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function usePartSpecs(filters = {}) {
  return useQuery({
    queryKey: ['part-specs', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '' && v !== null) params.set(k, v)
      }
      const { data } = await api.get(`/part-specs?${params}`)
      return data
    },
    enabled: Object.keys(filters).length > 0,
  })
}

// Fetch the full flat catalogue of part specs (all templates). Used by the
// Admin "Part Numbers" tab to manage every part in one list.
export function useAllPartSpecs() {
  return useQuery({
    queryKey: ['part-specs', 'all'],
    queryFn: async () => {
      const { data } = await api.get('/part-specs')
      return data.specs || []
    },
  })
}

// Typeahead lookup for known part numbers (catalogue + inspection history).
// Returns { results: [{ part_number, description, template_id, form_no,
// template_title, component_type, source }] }.
export function usePartNumberLookup(query = '', { templateId, enabled = true } = {}) {
  const q = (query || '').trim()
  return useQuery({
    queryKey: ['part-number-lookup', q, templateId || ''],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (templateId) params.set('template_id', templateId)
      const { data } = await api.get(`/part-specs/lookup?${params}`)
      return data.results || []
    },
    enabled,
    staleTime: 30_000,
    keepPreviousData: true,
  })
}

// The part spec an inspection is evaluated against: the server's own lookup,
// so the form and the server always judge a measurement against the same spec.
export function useResolvedPartSpec(templateId, partNumber) {
  const pn = (partNumber || '').trim()
  return useQuery({
    queryKey: ['part-specs', 'resolve', templateId || '', pn],
    queryFn: async () => {
      const params = new URLSearchParams({ template_id: templateId, part_number: pn })
      const { data } = await api.get(`/part-specs/resolve?${params}`)
      return data.spec || null
    },
    enabled: !!templateId && !!pn,
    staleTime: 30_000,
  })
}

export function useCreatePartSpec() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data } = await api.post('/part-specs', body)
      return data.spec
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['part-specs'] }),
  })
}

export function useUpdatePartSpec() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }) => {
      const { data } = await api.patch(`/part-specs/${id}`, body)
      return data.spec
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['part-specs'] }),
  })
}

// Bulk import part numbers from an Excel/CSV file (parsed server-side).
// Returns { created, updated, skipped, errors }.
export function useImportPartSpecs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file) => {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await api.post('/part-specs/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['part-specs'] }),
  })
}

// Seed the catalogue from part numbers already used on existing inspections.
export function useImportPartsFromInspections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/part-specs/import-from-inspections')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['part-specs'] }),
  })
}

export function useDeletePartSpec() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.delete(`/part-specs/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['part-specs'] }),
  })
}

// ── Product families: copying specs to related part numbers ────────────────

// The other part numbers in a part's product family. Returns
// { part, family: { name, explicit } | null, candidates: [...] }.
export async function fetchPartFamily(partSpecId) {
  const { data } = await api.get(`/part-specs/${partSpecId}/family`)
  return data
}

// What copying a part's saved specs to the selected parts would do (no changes).
export function usePropagationPreview() {
  return useMutation({
    mutationFn: async ({ sourceId, targetIds }) => {
      const { data } = await api.post(`/part-specs/${sourceId}/propagate/preview`, { target_ids: targetIds })
      return data.plans || []
    },
  })
}

// Copy a part's saved specs to the selected parts.
// targets: [{ id, replace_conflicts }]
export function usePropagateSpecs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ sourceId, targets }) => {
      const { data } = await api.post(`/part-specs/${sourceId}/propagate`, { targets })
      return data.results || []
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['part-specs'] }),
  })
}
