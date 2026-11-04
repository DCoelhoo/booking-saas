import type { D1Database } from '@cloudflare/workers-types'

const columns = `b.id, b.service_id, b.customer_name, b.start_at, b.end_at, s.name AS service_name`

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export async function handleBookings(request: Request, db: D1Database, organizationId: string): Promise<Response | null> {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/api\/bookings\/([^/]+)$/)
  if (url.pathname !== '/api/bookings' && !match) return null

  try {
    if (url.pathname === '/api/bookings' && request.method === 'GET') {
      const date = url.searchParams.get('date')
      if (!validDate(date)) return Response.json({ error: 'Data inválida.' }, { status: 400 })
      const { results } = await db.prepare(`
        SELECT ${columns} FROM bookings b
        JOIN services s ON s.id = b.service_id AND s.organization_id = b.organization_id
        WHERE b.organization_id = ? AND b.start_at >= ? AND b.start_at < ?
        ORDER BY b.start_at, b.id
      `).bind(organizationId, `${date}T00:00:00`, `${date}T24:00:00`).all()
      return Response.json({ bookings: results })
    }

    if (url.pathname === '/api/bookings' && request.method === 'POST') {
      let body: unknown
      try { body = await request.json() } catch {
        return Response.json({ error: 'JSON inválido.' }, { status: 400 })
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return Response.json({ error: 'Dados inválidos.' }, { status: 400 })
      }
      const { customer_name, service_id, date, start_time } = body as Record<string, unknown>
      if (typeof customer_name !== 'string' || !customer_name.trim() || customer_name.trim().length > 100 ||
          typeof service_id !== 'string' || !service_id || !validDate(date) ||
          typeof start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)) {
        return Response.json({ error: 'Nome, serviço, data ou hora inválidos.' }, { status: 400 })
      }
      const service = await db.prepare(`SELECT duration_minutes FROM services
        WHERE id = ? AND organization_id = ? AND is_active = 1`).bind(service_id, organizationId)
        .first<{ duration_minutes: number }>()
      if (!service) return Response.json({ error: 'O serviço não está disponível. Atualiza a lista de serviços.' }, { status: 400 })
      const [hours, minutes] = start_time.split(':').map(Number)
      if (hours * 60 + minutes < 540 || hours * 60 + minutes + service.duration_minutes > 1080) {
        return Response.json({ error: 'A marcação deve estar entre as 09:00 e as 18:00.' }, { status: 400 })
      }
      const id = crypto.randomUUID()
      const startAt = `${date}T${start_time}:00`
      // A single statement checks availability and inserts, preventing concurrent overlaps.
      const inserted = await db.prepare(`
        INSERT INTO bookings (id, organization_id, service_id, customer_name, start_at, end_at)
        SELECT ?, s.organization_id, s.id, ?, ?, strftime('%Y-%m-%dT%H:%M:%S', ?, '+' || s.duration_minutes || ' minutes')
        FROM services s
        WHERE s.id = ? AND s.organization_id = ? AND s.is_active = 1
          AND s.duration_minutes <= ?
          AND NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.organization_id = s.organization_id
              AND julianday(b.start_at) < julianday(?, '+' || s.duration_minutes || ' minutes')
              AND julianday(b.end_at) > julianday(?)
          )
        RETURNING id
      `).bind(id, customer_name.trim(), startAt, startAt, service_id, organizationId,
        1080 - (hours * 60 + minutes), startAt, startAt).first()
      if (!inserted) return Response.json({ error: 'O horário ou o serviço deixou de estar disponível. Atualiza a agenda.' }, { status: 409 })
      const booking = await db.prepare(`SELECT ${columns} FROM bookings b
        JOIN services s ON s.id = b.service_id AND s.organization_id = b.organization_id
        WHERE b.id = ? AND b.organization_id = ?`).bind(id, organizationId).first()
      return Response.json(booking, { status: 201 })
    }

    if (match && request.method === 'DELETE') {
      const deleted = await db.prepare('DELETE FROM bookings WHERE id = ? AND organization_id = ? RETURNING id')
        .bind(match[1], organizationId).first()
      return deleted ? new Response(null, { status: 204 })
        : Response.json({ error: 'Marcação não encontrada.' }, { status: 404 })
    }
    return Response.json({ error: 'Método não permitido.' }, { status: 405 })
  } catch (error) {
    console.error('Erro na agenda:', error)
    return Response.json({ error: 'Não foi possível concluir a operação na agenda.' }, { status: 500 })
  }
}
