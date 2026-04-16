import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ncrs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
