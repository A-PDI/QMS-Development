import { useQuery } from '@tanstack/react-query'
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
