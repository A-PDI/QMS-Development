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
