/**
 * The repair badge on one test result in the Injector Tests list.
 *
 * A repair belongs to the result it was recorded on, and its retest is the
 * next result for that injector. The server sends each row only its own role
 * (see repairRolesForTests in server/services/injectorRepairs.js):
 *
 *   Result 1                    → no badge
 *   Result 3 (repair recorded)  → "Repair #1"
 *   Result 4 (retest, repaired) → "Repair #2"
 *   Result 5 (passing retest)   → "Pass · after Repair #2"
 */

const CASE_NOTES = { HOLD: 'Hold', ENGINEERING_REVIEW: 'Engineering Review', SCRAPPED: 'Scrapped' }

/** { tone: 'repair' | 'retest' | 'pass', label, title } or null. */
export function repairBadge(row) {
  if (!row) return null
  const caseNote = CASE_NOTES[row.repair_case_status]
  const retestNote = row.retest_of_attempt
    ? `Retest of Repair #${row.retest_of_attempt} — ${String(row.retest_outcome || 'unknown').toUpperCase()}`
    : undefined

  if (row.repair_attempt_number) {
    const parts = [`Repair #${row.repair_attempt_number}`]
    if (row.repair_attempt_status === 'WAITING_RETEST') parts.push('awaiting retest')
    if (caseNote) parts.push(caseNote)
    return { tone: 'repair', label: parts.join(' · '), title: retestNote }
  }

  if (row.retest_of_attempt) {
    if (String(row.retest_outcome || '').toUpperCase() === 'PASS') {
      return { tone: 'pass', label: `Pass · after Repair #${row.retest_of_attempt}`, title: retestNote }
    }
    const parts = [`Retest of Repair #${row.retest_of_attempt}`]
    if (caseNote) parts.push(caseNote)
    return { tone: 'retest', label: parts.join(' · '), title: retestNote }
  }

  return null
}

/** Sentence added to the sync summary when retests were linked to repairs. */
export function linkedRepairsMessage(count) {
  const n = Number(count) || 0
  if (n <= 0) return ''
  return `Linked ${n} new retest${n === 1 ? '' : 's'} to ${n === 1 ? 'its repair' : 'their repairs'}.`
}
