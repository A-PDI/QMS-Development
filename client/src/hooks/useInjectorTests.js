import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export function useInjectorTests(filters = {}) {
  const safeFilters = filters || {}
  return useQuery({
    queryKey: ['injector-tests', safeFilters],
    queryFn: async () => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(safeFilters)) {
        if (v !== undefined && v !== '' && v !== null) params.set(k, v)
      }
      const { data } = await api.get(`/injector-tests?${params}`)
      return data
    },
  })
}

export function useInjectorSyncStatus() {
  return useQuery({
    queryKey: ['injector-tests-sync-status'],
    queryFn: async () => {
      const { data } = await api.get('/injector-tests/sync-status')
      return data
    },
    refetchInterval: 30 * 1000,
  })
}

export function useSyncInjectorTests() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/injector-tests/sync')
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['injector-tests'] })
      qc.invalidateQueries({ queryKey: ['injector-tests-sync-status'] })
    },
  })
}

export function useCreateInjectorInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (result_ids) => {
      const { data } = await api.post('/injector-tests/create-inspection', { result_ids })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['injector-tests'] })
      qc.invalidateQueries({ queryKey: ['inspections'] })
    },
  })
}

export async function downloadInjectorComparisonPdf(result_ids) {
  const response = await api.post('/injector-tests/report/pdf', { result_ids }, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  const a = document.createElement('a')
  a.href = url
  a.download = `Injector_Comparison_${Date.now()}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
