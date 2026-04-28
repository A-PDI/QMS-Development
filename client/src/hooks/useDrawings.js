import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function useDrawings(partNumber) {
  return useQuery({
    queryKey: ['drawings', partNumber],
    queryFn: async () => {
      const { data } = await api.get(`/drawings?part_number=${encodeURIComponent(partNumber)}`)
      return data.drawings || []
    },
    enabled: !!partNumber,
  })
}

export function useUploadDrawing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ partNumber, version, notes, file }) => {
      const form = new FormData()
      form.append('part_number', partNumber)
      form.append('version', version)
      if (notes) form.append('notes', notes)
      form.append('drawing', file)
      const { data } = await api.post('/drawings', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data.drawing
    },
    onSuccess: (_, { partNumber }) => {
      qc.invalidateQueries({ queryKey: ['drawings', partNumber] })
    },
  })
}

export function useSetCurrentDrawing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, partNumber }) => {
      const { data } = await api.patch(`/drawings/${id}/set-current`)
      return data
    },
    onSuccess: (_, { partNumber }) => {
      qc.invalidateQueries({ queryKey: ['drawings', partNumber] })
    },
  })
}

export function useDeleteDrawing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, partNumber }) => {
      const { data } = await api.delete(`/drawings/${id}`)
      return data
    },
    onSuccess: (_, { partNumber }) => {
      qc.invalidateQueries({ queryKey: ['drawings', partNumber] })
    },
  })
}
