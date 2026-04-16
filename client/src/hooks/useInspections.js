import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function useInspections(filters = {}, options = {}) {
  const safeFilters = filters || {}
  return useQuery({
    queryKey: ['inspections', safeFilters],
    queryFn: async () => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(safeFilters)) {
        if (v !== undefined && v !== '' && v !== null) params.set(k, v)
      }
      const { data } = await api.get(`/inspections?${params}`)
      return data
    },
    // Always produce a strict boolean — options.enabled may be null/undefined
    enabled: options.enabled === undefined ? true : Boolean(options.enabled),
  })
}

export function useInspection(id) {
  return useQuery({
    queryKey: ['inspection', id],
    queryFn: async () => {
      const { data } = await api.get(`/inspections/${id}`)
      return data.inspection
    },
    enabled: !!id,
  })
}

export function useCreateInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data } = await api.post('/inspections', body)
      return data.inspection
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inspections'] }),
  })
}

export function useUpdateInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }) => {
      const { data } = await api.patch(`/inspections/${id}`, body)
      return data
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['inspection', id] })
    },
  })
}

export function useCompleteInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.post(`/inspections/${id}/complete`)
      return data
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['inspection', id] })
      qc.invalidateQueries({ queryKey: ['inspections'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.delete(`/inspections/${id}`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspections'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useLogActivity() {
  return useMutation({
    mutationFn: async ({ id, action_type }) => {
      const { data } = await api.post(`/inspections/${id}/log-activity`, { action_type })
      return data
    },
  })
}
