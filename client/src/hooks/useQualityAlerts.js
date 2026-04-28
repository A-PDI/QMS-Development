import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function useQualityAlerts(params = {}) {
  return useQuery({
    queryKey: ['quality-alerts', params],
    queryFn: async () => {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') p.set(k, v)
      }
      const { data } = await api.get(`/quality-alerts?${p}`)
      return data.alerts || []
    },
  })
}

export function useQualityAlertCount() {
  return useQuery({
    queryKey: ['quality-alerts-count'],
    queryFn: async () => {
      const { data } = await api.get('/quality-alerts/count')
      return data.unacknowledged || 0
    },
    refetchInterval: 60000, // refresh every minute
  })
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.patch(`/quality-alerts/${id}/acknowledge`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality-alerts'] })
      qc.invalidateQueries({ queryKey: ['quality-alerts-count'] })
    },
  })
}
