import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSignature, PlusCircle, Search, Inbox, ChevronRight } from 'lucide-react'
import { useEnvelopes, useEsignInbox } from '../../hooks/useEsign'
import { ENVELOPE_STATUS } from '../../lib/esign'
import { formatDateTime } from '../../lib/utils'
import EnvelopeStatusBadge from '../../components/esign/EnvelopeStatusBadge'

export default function EsignList() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState({ page: 1, limit: 25, status: '' })
  const [search, setSearch] = useState('')
  const { data, isLoading, isError } = useEnvelopes(filters)
  const { data: inbox = [] } = useEsignInbox()
  const envelopes = data?.envelopes || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / filters.limit))

  const open = (env) => navigate(env.status === 'draft' ? `/esign/${env.id}/edit` : `/esign/${env.id}`)

  return (
    <div className="min-h-full bg-gray-50/50">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-pdi-navy flex items-center gap-2">
              <FileSignature size={20} className="text-pdi-amber flex-shrink-0" />
              <span className="truncate">E-Sign</span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{total} envelope{total === 1 ? '' : 's'}</p>
          </div>
          <button
            onClick={() => navigate('/esign/new')}
            className="flex items-center gap-2 bg-pdi-amber text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-sm font-semibold hover:brightness-95 shadow-sm flex-shrink-0"
          >
            <PlusCircle size={16} />
            <span className="hidden sm:inline">Send a document</span>
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {inbox.length > 0 && (
          <button
            type="button"
            onClick={() => navigate('/esign/inbox')}
            className="w-full flex items-center justify-between gap-3 rounded-xl border border-pdi-amber/40 bg-pdi-amber-light/40 px-4 py-3 text-left hover:bg-pdi-amber-light/70"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-pdi-navy">
              <Inbox size={16} className="text-pdi-amber" />
              {inbox.length} document{inbox.length === 1 ? '' : 's'} waiting for your signature
            </span>
            <ChevronRight size={16} className="text-pdi-navy" />
          </button>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
          <form
            onSubmit={(e) => { e.preventDefault(); setFilters((f) => ({ ...f, search, page: 1 })) }}
            className="flex gap-2 w-full sm:w-auto"
          >
            <div className="relative flex-1 sm:flex-initial">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Title, file, signer…"
                className="w-full sm:w-64 pl-8 pr-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pdi-navy"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="submit" className="px-3 py-2 sm:py-1.5 text-sm bg-pdi-navy text-white rounded-lg">Search</button>
          </form>
          <select
            className="w-full sm:w-auto px-3 py-2 sm:py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
          >
            <option value="">All statuses</option>
            {Object.entries(ENVELOPE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="text-center text-gray-400 py-12 text-sm">Loading…</div>
          ) : isError ? (
            <div className="text-center text-pdi-red py-12 text-sm">Could not load envelopes.</div>
          ) : envelopes.length === 0 ? (
            <div className="text-center py-14 px-4">
              <FileSignature size={28} className="mx-auto text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">No envelopes yet.</p>
              <button onClick={() => navigate('/esign/new')} className="mt-3 text-sm font-semibold text-pdi-navy hover:underline">
                Send your first document
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {envelopes.map((env) => (
                <li key={env.id}>
                  <button
                    type="button"
                    onClick={() => open(env)}
                    className="w-full text-left px-4 py-3 hover:bg-pdi-frost/40 flex items-center gap-3 min-h-[56px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm text-pdi-navy truncate">{env.title}</span>
                        <EnvelopeStatusBadge status={env.status} />
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500 truncate">
                        {env.original_name}
                        {env.status !== 'draft' && env.recipient_count > 0 && (
                          <> · {env.signed_count}/{env.recipient_count} signed</>
                        )}
                        {' · '}updated {formatDateTime(env.updated_at)}
                      </div>
                    </div>
                    {env.recipient_count > 0 && env.status !== 'draft' && (
                      <div className="hidden sm:block w-28">
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full bg-pdi-green"
                            style={{ width: `${Math.round((env.signed_count / env.recipient_count) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-xs">
              <span className="text-gray-500">Page {filters.page} of {totalPages}</span>
              <div className="flex gap-2">
                <button disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                  className="px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40">Previous</button>
                <button disabled={filters.page >= totalPages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                  className="px-3 py-1.5 rounded-md border border-gray-200 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
