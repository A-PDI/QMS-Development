/**
 * Format the CarbonZapp report timestamp as the test bench recorded it.
 *
 * CarbonZapp supplies an ISO-like `datetime` value with an offset. Constructing
 * a JavaScript Date from that value converts it into the viewer's time zone,
 * which can move the displayed test time by several hours. The Tested column
 * represents the report's bench clock, so read the date/time components from
 * the source value without applying a browser time-zone conversion.
 */
export function formatInjectorTestDateTime(value) {
  if (value == null || String(value).trim() === '') return '—'

  const raw = String(value).trim()
  const match = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i,
  )
  if (!match) return raw

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = hourText == null ? null : Number(hourText)
  const minute = minuteText == null ? null : Number(minuteText)

  const validDate = month >= 1 && month <= 12
    && day >= 1
    && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
  const validTime = hour == null || (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)
  if (!validDate || !validTime) return raw

  const date = `${monthText}/${dayText}/${yearText.slice(-2)}`
  if (hour == null) return date

  const hour12 = hour % 12 || 12
  const period = hour < 12 ? 'AM' : 'PM'
  return `${date}, ${String(hour12).padStart(2, '0')}:${minuteText} ${period}`
}
