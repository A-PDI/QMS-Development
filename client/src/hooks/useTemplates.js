import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const { data } = await api.get('/templates')
      return data.templates
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useTemplate(id) {
  return useQuery({
    queryKey: ['template', id],
    queryFn: async () => {
      const { data } = await api.get(`/templates/${id}`)
      return data.template
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data } = await api.post('/admin/templates', body)
      return data.template
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useInspectionItems() {
  return useQuery({
    queryKey: ['inspection-items'],
    queryFn: async () => {
      const { data } = await api.get('/admin/inspection-items')
      return data.items  // { [section_type]: [{id, name, ...}] }
    },
    staleTime: 10 * 60 * 1000,
  })
}