// Until organizations have configurable time zones, business time is Europe/Lisbon.
export function businessNow(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date())
  return parts.replace(' ', 'T')
}

