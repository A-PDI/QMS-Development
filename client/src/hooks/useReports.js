import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function useRunReport(config, enabled = true) {
  return useQuery({
    queryKey: ['report-query', config],
    queryFn: async () => {
      const { data } = await api.post('/reports/query', config)
      return data
    },
    enabled: enabled && !!config,
  })
}

export function useSavedReports() {
  return useQuery({
    queryKey: ['saved-reports'],
    queryFn: async () => {
      const { data } = await api.get('/reports/saved')
      return data.reports || []
    },
  })
}

export function useSaveReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, config_json }) => {
      const { data } = await api.post('/reports/saved', { name, config_json })
      return data.report
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  })
}

export function useDeleteSavedReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.delete(`/reports/saved/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  })
}
