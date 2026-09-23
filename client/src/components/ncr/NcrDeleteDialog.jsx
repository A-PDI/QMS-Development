/** Confirmation before an admin deletes an NCR (and its photos). */
export default function NcrDeleteDialog({ ncr, deleting, onCancel, onConfirm }) {
  if (!ncr) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden" role="dialog" aria-modal="true" aria-labelledby="ncr-delete-title">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <h3 id="ncr-delete-title" className="text-base font-semibold text-gray-900">Delete NCR?</h3>
        <p className="text-sm text-gray-600">
          Delete <span className="font-mono font-bold">{ncr.ncr_number}</span> with all of its sections and photos? This cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} disabled={deleting} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 min-h-[40px]">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={deleting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 min-h-[40px]">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
