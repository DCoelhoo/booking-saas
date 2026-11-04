// Until organizations have configurable time zones, business time is Europe/Lisbon.
export function businessNow(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)
  return parts.replace(' ', 'T')
}

// Convert the stored civil Lisbon time into an instant, accounting for DST.
// Nonexistent civil times during the spring change have no corresponding instant.
export function businessTimestamp(value: string): number | null {
  const civil = Date.parse(`${value}Z`)
  if (!Number.isFinite(civil)) return null
  let instant = civil
  for (let i = 0; i < 3; i++) {
    const represented = Date.parse(`${businessNow(new Date(instant))}Z`)
    if (represented === civil) return instant
    instant += civil - represented
  }
  return businessNow(new Date(instant)) === value ? instant : null
}

