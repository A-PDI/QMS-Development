// Completing an inspection from the inspection form.
//
// The order matters: everything on the form is saved first, then the server
// is asked to complete the inspection, and only a confirmed completion sends
// the inspector back to the Inspections list. A failure at either step leaves
// them on the form with the error; photos still uploading hold completion
// back entirely so none is lost.

/** Where the inspector lands after completing an inspection. */
export const INSPECTIONS_LIST_PATH = '/inspections'

/**
 *   uploadsInFlight — photos still uploading
 *   save()          — persist the inspection's data (PATCH)
 *   complete()      — complete it (POST /complete); resolves with the response
 *
 * Returns one of
 *   { status: 'uploads_pending', count }
 *   { status: 'failed', stage: 'save' | 'complete', error }
 *   { status: 'completed', result, destination }
 */
export async function saveAndComplete({ uploadsInFlight = 0, save, complete }) {
  if (uploadsInFlight > 0) return { status: 'uploads_pending', count: uploadsInFlight }
  try {
    await save()
  } catch (error) {
    return { status: 'failed', stage: 'save', error }
  }
  try {
    const result = await complete()
    return { status: 'completed', result, destination: INSPECTIONS_LIST_PATH }
  } catch (error) {
    return { status: 'failed', stage: 'complete', error }
  }
}
