import type { D1Database } from '@cloudflare/workers-types'
import { availabilityCondition, validDate } from './availability.ts'
import { bookingNotification } from './bookingNotifications.ts'
import { changeBooking, findBooking } from './bookingLifecycle.ts'
import { jsonBody } from './auth.ts'

const columns = `b.staff_id, (SELECT name FROM staff_members WHERE id=b.staff_id) AS staff_name, b.status, b.version, b.id, b.service_id, b.customer_name, b.start_at, b.end_at, b.customer_email, b.customer_phone, b.booking_source, b.total_cents, b.online_due_cents, b.on_site_due_cents, b.payment_mode, COALESCE(b.service_name_snapshot, s.name) AS service_name`

export async function handleBookings(request: Request, db: D1Database, organizationId: string, emailPreview = false, staffScope: string | null = null): Promise<Response | null> {
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
        WHERE b.organization_id = ? AND b.start_at >= ? AND b.start_at < ? AND (? IS NULL OR b.staff_id = ?)
        ORDER BY b.start_at, b.id
      `).bind(organizationId, `${date}T00:00:00`, `${date}T24:00:00`, staffScope, staffScope).all()
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
      const suppliedStaff = (body as Record<string,unknown>).staff_id
      const staffId = typeof suppliedStaff === 'string' ? suppliedStaff : staffScope || `staff:${organizationId}`
      if (staffScope && staffId !== staffScope) return Response.json({ error: 'Só podes gerir a tua agenda.' }, { status:403 })
      if (typeof customer_name !== 'string' || !customer_name.trim() || customer_name.trim().length > 100 ||
          typeof service_id !== 'string' || !service_id || !validDate(date) ||
          typeof start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)) {
        return Response.json({ error: 'Nome, serviço, data ou hora inválidos.' }, { status: 400 })
      }
      const id = crypto.randomUUID()
      const startAt = `${date}T${start_time}:00`
      const candidate = `WITH candidate AS (
        SELECT s.id AS service_id, s.organization_id, m.id AS staff_id, s.duration_minutes, o.availability,
          ? AS start_at, strftime('%Y-%m-%dT%H:%M:%S', ?, '+' || s.duration_minutes || ' minutes') AS end_at
        FROM services s JOIN organizations o ON o.id = s.organization_id
        JOIN staff_members m ON m.organization_id = s.organization_id
        WHERE s.id = ? AND s.organization_id = ? AND s.is_active = 1 AND m.id = ? AND m.is_active = 1
      )`
      const allowed = availabilityCondition('c.availability', 'c.start_at', 'c.end_at')
      const service = await db.prepare(`${candidate} SELECT ${allowed} AS available FROM candidate c`)
        .bind(startAt, startAt, service_id, organizationId, staffId).first<{ available: number }>()
      if (!service) return Response.json({ error: 'O serviço não está disponível. Atualiza a lista de serviços.' }, { status: 400 })
      if (!service.available) return Response.json({ error: 'A marcação fica fora dos períodos de funcionamento ou coincide com um encerramento.' }, { status: 400 })
      // Availability and overlap are rechecked in the same statement as the insert.
      const insertBooking = db.prepare(`${candidate}
        INSERT INTO bookings (id, organization_id, service_id, customer_name, start_at, end_at, staff_id)
        SELECT ?, c.organization_id, c.service_id, ?, c.start_at, c.end_at, c.staff_id FROM candidate c
        WHERE ${allowed} AND NOT EXISTS (
          SELECT 1 FROM bookings b WHERE b.organization_id = c.organization_id AND b.staff_id = c.staff_id AND b.status != 'canceled'
            AND julianday(b.start_at) < julianday(c.end_at)
            AND julianday(b.end_at) > julianday(c.start_at)
        ) RETURNING id`).bind(startAt, startAt, service_id, organizationId, staffId, id, customer_name.trim())
      const [inserted] = await db.batch([
        insertBooking,
        bookingNotification(db, id, organizationId, emailPreview),
        bookingNotification(db, id, organizationId, emailPreview, true),
      ])
      if (!inserted.results.length) return Response.json({ error: 'O horário ou o serviço deixou de estar disponível. Atualiza a agenda.' }, { status: 409 })
      const booking = await db.prepare(`SELECT ${columns} FROM bookings b
        JOIN services s ON s.id = b.service_id AND s.organization_id = b.organization_id
        WHERE b.id = ? AND b.organization_id = ?`).bind(id, organizationId).first()
      return Response.json(booking, { status: 201 })
    }

    if (match && ['PATCH', 'DELETE'].includes(request.method)) {
      const booking = await findBooking(db, match[1], organizationId)
      if (booking && staffScope && booking.staff_id !== staffScope) return Response.json({ error: 'Marcação não encontrada.' }, { status:404 })
      if (!booking || (request.method === 'DELETE' && booking.status === 'canceled')) return Response.json({ error: 'Marcação não encontrada.' }, { status: 404 })
      const body = request.method === 'DELETE' ? { status: 'canceled', version: booking.version } : await jsonBody(request)
      if (!body || typeof body.status !== 'string' || !['canceled', 'completed', 'no_show'].includes(body.status) || !Number.isSafeInteger(body.version)) return Response.json({ error: 'Estado ou versão inválidos.' }, { status: 400 })
      const result = await changeBooking(db, booking, body.status, body.version as number, 'owner', emailPreview)
      return request.method === 'DELETE' && result.ok ? new Response(null, { status: 204 }) : result
    }
    return Response.json({ error: 'Método não permitido.' }, { status: 405 })
  } catch (error) {
    console.error('Erro na agenda:', error)
    return Response.json({ error: 'Não foi possível concluir a operação na agenda.' }, { status: 500 })
  }
}
