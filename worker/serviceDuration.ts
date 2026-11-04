import type { D1Database } from '@cloudflare/workers-types'


// Until organizations have configurable time zones, business time is Europe/Lisbon.
export function businessNow(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date())
  return parts.replace(' ', 'T')
}

export const projection = `WITH projected AS (
  SELECT id, service_id, customer_name, start_at, end_at,
    CASE WHEN service_id = ? AND julianday(start_at) > julianday(?)
      THEN strftime('%Y-%m-%dT%H:%M:%S', start_at, '+' || ? || ' minutes')
      ELSE end_at END AS proposed_end,
    service_id = ? AND julianday(start_at) > julianday(?) AS affected
  FROM bookings WHERE organization_id = ?
)`

export const conflictCondition = `EXISTS (
  SELECT 1 FROM projected a WHERE a.affected AND (
    a.proposed_end IS NULL OR substr(a.proposed_end, 1, 10) != substr(a.start_at, 1, 10)
    OR substr(a.start_at, 12, 8) < '09:00:00' OR substr(a.proposed_end, 12, 8) > '18:00:00'
    OR EXISTS (SELECT 1 FROM projected b WHERE b.id != a.id
      AND julianday(a.start_at) < julianday(b.proposed_end)
      AND julianday(a.proposed_end) > julianday(b.start_at))
  )
)`

export const snapshot = `(SELECT json_group_array(json_object('id', id, 'start_at', start_at, 'end_at', end_at))
  FROM (SELECT id, start_at, end_at FROM projected WHERE affected ORDER BY id))`

export function projectionValues(id: string, now: string, duration: number, organizationId: string) {
  return [id, now, duration, id, now, organizationId]
}

export async function previewDuration(request: Request, db: D1Database, id: string, organizationId: string): Promise<Response> {
  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  const duration = typeof body === 'object' && body !== null && 'duration_minutes' in body ? body.duration_minutes : null
  if (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration <= 0) {
    return Response.json({ error: 'Duração inválida.' }, { status: 400 })
  }
  try {
    if (!await db.prepare('SELECT id FROM services WHERE id = ? AND organization_id = ?').bind(id, organizationId).first()) {
      return Response.json({ error: 'Serviço não encontrado.' }, { status: 404 })
    }
    const now = businessNow()
    // One query gives a consistent snapshot of the affected bookings and conflicts.
    const result = await db.prepare(`${projection}
      SELECT ${snapshot} AS snapshot, ${conflictCondition} AS has_conflicts,
        (SELECT json_group_array(json_object('id', id, 'customer_name', customer_name,
          'start_at', start_at, 'end_at', end_at, 'proposed_end', proposed_end))
         FROM (SELECT * FROM projected WHERE affected ORDER BY start_at, id)) AS bookings
    `).bind(...projectionValues(id, now, duration, organizationId)).first<{ snapshot: string; has_conflicts: number; bookings: string }>()
    return Response.json({ bookings: JSON.parse(result!.bookings), snapshot: result!.snapshot,
      has_conflicts: Boolean(result!.has_conflicts), cutoff: now })
  } catch (error) {
    console.error('Erro ao verificar duração:', error)
    return Response.json({ error: 'Não foi possível verificar as marcações.' }, { status: 500 })
  }
}
