import type { D1Database } from '@cloudflare/workers-types'
import { jsonBody } from './auth.ts'
import { businessNow } from './businessTime.ts'

export type Availability = {
  weekly: { start: string; end: string }[][]
  closures: { start_date: string; end_date: string; reason: string }[]
}

export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

const validTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

function validate(body: Record<string, unknown> | null): Availability | null {
  if (!body || !Array.isArray(body.weekly) || body.weekly.length !== 7 || !Array.isArray(body.closures) || body.closures.length > 100) return null
  const weekly: Availability['weekly'] = []
  for (const day of body.weekly) {
    if (!Array.isArray(day) || day.length > 8) return null
    const slots: Availability['weekly'][number] = []
    for (const slot of day) {
      if (!slot || typeof slot !== 'object' || !validTime(slot.start) || !validTime(slot.end) || slot.start >= slot.end) return null
      slots.push({ start: slot.start, end: slot.end })
    }
    slots.sort((a, b) => a.start.localeCompare(b.start))
    // Merge adjacent periods: a booking may span a boundary that is not a break.
    const merged: typeof slots = []
    for (const slot of slots) {
      const previous = merged.at(-1)
      if (previous && slot.start < previous.end) return null
      if (previous && slot.start === previous.end) previous.end = slot.end
      else merged.push({ ...slot })
    }
    weekly.push(merged)
  }
  const closures: Availability['closures'] = []
  for (const closure of body.closures) {
    if (!closure || typeof closure !== 'object' || !validDate(closure.start_date) || !validDate(closure.end_date) ||
        closure.start_date > closure.end_date || typeof closure.reason !== 'string' || closure.reason.length > 100) return null
    closures.push({ start_date: closure.start_date, end_date: closure.end_date, reason: closure.reason.trim() })
  }
  closures.sort((a, b) => a.start_date.localeCompare(b.start_date))
  return { weekly, closures }
}

// Only trusted SQL expressions are accepted here. All request data is bound separately.
export function availabilityCondition(config: string, start: string, end: string): string {
  return `(
    julianday(${end}) > julianday(${start})
    AND substr(${start}, 1, 10) = substr(${end}, 1, 10)
    AND EXISTS (
      SELECT 1 FROM json_each(${config}, '$.weekly[' || strftime('%w', ${start}) || ']') slot
      WHERE substr(${start}, 12, 8) >= json_extract(slot.value, '$.start') || ':00'
        AND substr(${end}, 12, 8) <= json_extract(slot.value, '$.end') || ':00'
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(${config}, '$.closures') closure
      WHERE substr(${start}, 1, 10) BETWEEN json_extract(closure.value, '$.start_date') AND json_extract(closure.value, '$.end_date')
    )
  )`
}

export async function handleAvailability(request: Request, db: D1Database, organizationId: string): Promise<Response> {
  if (request.method === 'GET') {
    const row = await db.prepare('SELECT availability FROM organizations WHERE id = ?').bind(organizationId).first<{ availability: string }>()
    return Response.json(JSON.parse(row!.availability))
  }
  if (request.method !== 'PUT') return Response.json({ error: 'Método não permitido.' }, { status: 405 })
  const availability = validate(await jsonBody(request))
  if (!availability) return Response.json({ error: 'Verifica os horários: indica os sete dias, até oito períodos por dia sem sobreposições e encerramentos com datas válidas. Cada período deve começar e terminar no mesmo dia.' }, { status: 400 })
  const encoded = JSON.stringify(availability)
  const now = businessNow()
  const allowed = availabilityCondition('p.availability', 'b.start_at', 'b.end_at')
  // The guard and the write share one statement, including concurrent new bookings.
  const updated = await db.prepare(`WITH proposed AS (SELECT ? AS availability)
    UPDATE organizations SET availability = (SELECT availability FROM proposed)
    WHERE id = ? AND NOT EXISTS (
      SELECT 1 FROM bookings b, proposed p WHERE b.organization_id = ?
        AND julianday(b.end_at) > julianday(?) AND NOT ${allowed}
    ) RETURNING availability`).bind(encoded, organizationId, organizationId, now).first()
  if (!updated) {
    const conflicts = await db.prepare(`WITH proposed AS (SELECT ? AS availability)
      SELECT b.id, b.customer_name, b.start_at, b.end_at, COUNT(*) OVER () AS total
      FROM bookings b, proposed p WHERE b.organization_id = ?
        AND julianday(b.end_at) > julianday(?) AND NOT ${allowed}
      ORDER BY b.start_at LIMIT 50`).bind(encoded, organizationId, now).all()
    return Response.json({ error: 'Estes horários entram em conflito com marcações ainda por concluir. Ajusta o horário ou resolve essas marcações antes de guardar.',
      conflicts: conflicts.results }, { status: 409 })
  }
  return Response.json(availability)
}
