import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function useAttachments(inspectionId) {
  return useQuery({
    queryKey: ['attachments', inspectionId],
    queryFn: async () => {
      const { data } = await api.get(`/attachments/${inspectionId}`)
      return data.attachments
    },
    enabled: !!inspectionId,
  })
}

export function useUploadAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ inspectionId, file, sectionKey, itemId }) => {
      const form = new FormData()
      form.append('file', file)
      if (sectionKey) form.append('section_key', sectionKey)
      if (itemId !== undefined && itemId !== null) form.append('item_id', String(itemId))
      const { data } = await api.post(`/attachments/${inspectionId}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data
    },
    onSuccess: (_, { inspectionId }) => {
      qc.invalidateQueries({ queryKey: ['attachments', inspectionId] })
    },
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, inspectionId }) => {
      await api.delete(`/attachments/${id}`)
      return inspectionId
    },
    onSuccess: (inspectionId) => {
      qc.invalidateQueries({ queryKey: ['attachments', inspectionId] })
    },
  })
}
