import { createHash, randomBytes } from 'node:crypto'
import type { D1Database } from '@cloudflare/workers-types'
import { jsonBody } from './auth.ts'
import { availabilityCondition, validDate, type Availability } from './availability.ts'
import { businessNow } from './businessTime.ts'
import { appUrl, localPreview, type EmailEnv } from './email.ts'
import { subscriptionAccess, type SubscriptionFields } from './subscriptions.ts'

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export function bookingLink(env: EmailEnv) {
  const token = randomBytes(32).toString('base64url')
  return { hash: tokenHash(token), expires: Date.now() + 180 * 86_400_000,
    url: `${appUrl(env)}/reserva/gerir#token=${token}` }
}
export type LifecycleBooking = SubscriptionFields & {
  id: string; organization_id: string; service_id: string; status: string; version: number
  start_at: string; end_at: string; customer_name: string; customer_email: string
  service_name: string; business_name: string; contact_email: string; phone: string
  availability: string; booking_change_hours: number; is_active: number
}
const select = `SELECT b.*, COALESCE(b.service_name_snapshot, s.name) AS service_name,
  o.name AS business_name, o.contact_email, o.phone, o.availability, o.booking_change_hours,
  o.trial_started_at, o.trial_ends_at, o.subscription_status, o.paid_until, s.is_active
  FROM bookings b JOIN organizations o ON o.id = b.organization_id
  JOIN services s ON s.id = b.service_id AND s.organization_id = b.organization_id`
export const findBooking = (db: D1Database, id: string, org: string) => db.prepare(`${select} WHERE b.id = ? AND b.organization_id = ?`).bind(id, org).first<LifecycleBooking>()
const conflict = () => Response.json({ error: 'A marcação ou o horário mudou. Atualiza a página e tenta novamente.' }, { status: 409 })
function beforeDeadline(b: LifecycleBooking) {
  const cutoff = new Date(`${b.start_at}Z`).getTime() - b.booking_change_hours * 3_600_000
  return new Date(`${businessNow()}Z`).getTime() < cutoff
}
function canChange(b: LifecycleBooking) { return b.status === 'confirmed' && beforeDeadline(b) }
const maxDate = () => new Date(Date.parse(`${businessNow().slice(0, 10)}T12:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10)
const time = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
function duration(b: LifecycleBooking) { return Math.round((Date.parse(`${b.end_at}Z`) - Date.parse(`${b.start_at}Z`)) / 60000) }

async function availableSlots(db: D1Database, b: LifecycleBooking, date: string) {
  const config: Availability = JSON.parse(b.availability)
  if (config.closures.some((p) => date >= p.start_date && date <= p.end_date)) return []
  const { results } = await db.prepare(`SELECT start_at, end_at FROM bookings WHERE organization_id = ? AND id != ? AND status != 'canceled'
    AND julianday(start_at) < julianday(?) AND julianday(end_at) > julianday(?)`)
    .bind(b.organization_id, b.id, `${date}T23:59:59`, `${date}T00:00:00`).all<{ start_at: string; end_at: string }>()
  const slots = []
  for (const p of config.weekly[new Date(`${date}T12:00:00Z`).getUTCDay()]) {
    for (let m = minute(p.start); m + duration(b) <= minute(p.end); m += 15) {
      const start = `${date}T${time(m)}:00`, end = `${date}T${time(m + duration(b))}:00`
      if (start > businessNow() && !results.some((other) => start < other.end_at && end > other.start_at)) slots.push({ start_time: time(m), end_time: time(m + duration(b)) })
    }
  }
  return slots
}

export async function changeBooking(db: D1Database, b: LifecycleBooking, action: string, version: number, actor: 'owner' | 'customer', preview: boolean, date?: unknown, startTime?: unknown): Promise<Response> {
  if (version !== b.version || b.status !== 'confirmed') return conflict()
  if (actor === 'customer' && !canChange(b)) return Response.json({ error: 'O prazo para alterações online terminou. Contacta diretamente o negócio.' }, { status: 403 })
  const reschedule = action === 'reschedule'
  if (!['canceled', 'completed', 'no_show', 'reschedule'].includes(action) || (actor === 'customer' && !['canceled', 'reschedule'].includes(action))) {
    return Response.json({ error: 'Estado inválido.' }, { status: 400 })
  }
  if (['completed', 'no_show'].includes(action) && b.end_at > businessNow()) return Response.json({ error: 'Só podes concluir ou registar uma falta depois do fim da marcação.' }, { status: 400 })
  let start = b.start_at, end = b.end_at
  if (reschedule) {
    if (!subscriptionAccess(b).can_manage || !b.is_active) return Response.json({ error: 'O reagendamento online está indisponível. Contacta o negócio.' }, { status: 403 })
    if (!validDate(date) || date < businessNow().slice(0, 10) || date > maxDate() || typeof startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return Response.json({ error: 'Escolhe uma data e hora válidas nos próximos 90 dias.' }, { status: 400 })
    const slot = (await availableSlots(db, b, date)).find((s) => s.start_time === startTime)
    if (!slot) return conflict()
    start = `${date}T${slot.start_time}:00`; end = `${date}T${slot.end_time}:00`
    if (start === b.start_at) return Response.json({ error: 'Escolhe um horário diferente do atual.' }, { status: 400 })
  }
  const status = reschedule ? 'confirmed' : action
  const event = crypto.randomUUID()
  const now = businessNow()
  // Recheck all mutable rules inside the write. A stale slot response never moves the original booking.
  const allowed = availabilityCondition('o.availability', '(SELECT start_at FROM proposed)', '(SELECT end_at FROM proposed)')
  const update = db.prepare(`WITH proposed AS (SELECT ? AS start_at, ? AS end_at)
    UPDATE bookings SET status = ?, start_at = ?, end_at = ?, version = version + 1
    WHERE id = ? AND organization_id = ? AND status = 'confirmed' AND version = ?
      AND (? = 'owner' OR julianday(start_at) - (SELECT booking_change_hours / 24.0 FROM organizations WHERE id = organization_id) > julianday(?))
      AND (? = 0 OR (? > ? AND EXISTS (
        SELECT 1 FROM organizations o JOIN services s ON s.organization_id = o.id
        WHERE o.id = bookings.organization_id AND s.id = bookings.service_id AND s.is_active = 1
          AND ((o.trial_started_at <= ? AND o.trial_ends_at > ?) OR (o.subscription_status IN ('active', 'canceled') AND o.paid_until > ?))
          AND ${allowed}
          AND EXISTS (SELECT 1 FROM json_each(o.availability, '$.weekly[' || strftime('%w', ?) || ']') p
            WHERE substr(?,12,5) >= json_extract(p.value,'$.start') AND substr(?,12,5) <= json_extract(p.value,'$.end')
              AND ((strftime('%H', ?) * 60 + strftime('%M', ?) - (substr(json_extract(p.value,'$.start'),1,2)*60 + substr(json_extract(p.value,'$.start'),4,2))) % 15) = 0))
        AND NOT EXISTS (SELECT 1 FROM bookings other WHERE other.organization_id = bookings.organization_id AND other.id != bookings.id AND other.status != 'canceled'
          AND julianday(other.start_at) < julianday(?) AND julianday(other.end_at) > julianday(?)))) RETURNING id`)
    .bind(start, end, status, start, end, b.id, b.organization_id, version, actor, now, reschedule ? 1 : 0, start, now,
      Date.now(), Date.now(), Date.now(), start, start, end, start, start, end, start)
  const eventStatement = db.prepare(`INSERT INTO booking_events (id, booking_id, organization_id, actor, kind, previous_start_at, previous_end_at, start_at, end_at, status, version)
    SELECT ?, id, organization_id, ?, ?, ?, ?, start_at, end_at, status, version FROM bookings
    WHERE changes() = 1 AND id = ? AND organization_id = ? AND version = ?`)
    .bind(event, actor, action, b.start_at, b.end_at, b.id, b.organization_id, version + 1)
  const notifications = ['business', 'customer'].map((recipient) => db.prepare(`INSERT INTO email_outbox (id, organization_id, kind, payload, status)
    SELECT ?, b.organization_id, 'booking_changed', json_object('to', ${recipient === 'customer' ? 'b.customer_email' : "CASE WHEN o.contact_email != '' THEN o.contact_email ELSE u.email END"},
      'subject', ? || ' — ' || o.name,
      'text', ? || char(10) || 'Cliente: ' || b.customer_name || char(10) || 'Serviço: ' || COALESCE(b.service_name_snapshot, s.name) || char(10) ||
        'Horário anterior: ' || e.previous_start_at || ' – ' || e.previous_end_at || char(10) ||
        'Horário: ' || b.start_at || ' – ' || b.end_at || ' (hora de Lisboa)' || char(10) || 'Referência: ' || b.id || char(10) || 'Para outras alterações, utiliza o link do email de confirmação ou contacta o negócio.'), ?
    FROM booking_events e JOIN bookings b ON b.id = e.booking_id JOIN organizations o ON o.id = b.organization_id
    JOIN users u ON u.organization_id = b.organization_id JOIN services s ON s.id = b.service_id
    WHERE e.id = ? AND ${recipient === 'customer' ? "b.customer_email != ''" : '1 = 1'}`)
    .bind(`${event}:${recipient}`, reschedule ? 'Marcação reagendada' : status === 'canceled' ? 'Marcação cancelada' : status === 'completed' ? 'Marcação concluída' : 'Falta de comparência registada',
      reschedule ? 'A marcação foi reagendada. O preço acordado mantém-se.' : status === 'canceled' ? 'A marcação foi cancelada.' : status === 'completed' ? 'A marcação foi concluída.' : 'Foi registada uma falta de comparência.', preview ? 'preview' : 'pending', event))
  const invalidateReminders = db.prepare(`UPDATE email_outbox SET status = 'expired', payload = NULL, claim_token = NULL
    WHERE booking_id = ? AND kind = 'booking_reminder' AND status IN ('pending', 'sending', 'preview', 'failed')
      AND EXISTS (SELECT 1 FROM booking_events WHERE id = ?)`)
    .bind(b.id, event)
  const [updated] = await db.batch([update, eventStatement, ...notifications, invalidateReminders])
  return updated.results.length ? Response.json({ id: b.id, status, start_at: start, end_at: end, version: version + 1 }) : conflict()
}

export async function handleBookingManagement(request: Request, env: EmailEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (!['/api/booking-management', '/api/booking-management/slots'].includes(url.pathname)) return null
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || ''
  if (!/^[\w-]{43}$/.test(token)) return Response.json({ error: 'Link inválido ou expirado.' }, { status: 404 })
  const db = env.booking_saas_db
  const b = await db.prepare(`${select} WHERE b.management_token_hash = ? AND b.management_expires_at > ?`).bind(tokenHash(token), Date.now()).first<LifecycleBooking>()
  if (!b) return Response.json({ error: 'Link inválido ou expirado. Contacta o negócio.' }, { status: 404 })
  if (request.method === 'GET' && url.pathname.endsWith('/slots')) {
    if (!canChange(b) || !subscriptionAccess(b).can_manage || !b.is_active) return Response.json({ error: 'O reagendamento online está indisponível. Contacta o negócio.' }, { status: 403 })
    const date = url.searchParams.get('date')
    if (!validDate(date) || date < businessNow().slice(0, 10) || date > maxDate()) return Response.json({ error: 'Data inválida.' }, { status: 400 })
    return Response.json({ slots: await availableSlots(db, b, date) })
  }
  if (request.method === 'GET') return Response.json({ booking: { id: b.id, service_name: b.service_name, status: b.status, version: b.version, start_at: b.start_at, end_at: b.end_at },
    business: { name: b.business_name, contact_email: b.contact_email, phone: b.phone }, change_hours: b.booking_change_hours,
    can_cancel: canChange(b), can_reschedule: canChange(b) && !!b.is_active && subscriptionAccess(b).can_manage,
    today: businessNow().slice(0, 10), max_date: maxDate() })
  if (request.method === 'POST' && url.pathname === '/api/booking-management') {
    const body = await jsonBody(request)
    if (!body || typeof body.action !== 'string' || !Number.isSafeInteger(body.version)) return Response.json({ error: 'Dados inválidos.' }, { status: 400 })
    return changeBooking(db, b, body.action, body.version as number, 'customer', localPreview(request, env), body.date, body.start_time)
  }
  return Response.json({ error: 'Método não permitido.' }, { status: 405 })
}
