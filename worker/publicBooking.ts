import { createHash } from 'node:crypto'
import type { D1Database } from '@cloudflare/workers-types'
import { jsonBody, validEmail, validSlug } from './auth.ts'
import { availabilityCondition, validDate, type Availability } from './availability.ts'
import { businessNow } from './businessTime.ts'
import { subscriptionAccess, type SubscriptionFields } from './subscriptions.ts'
import { paymentQuote, type BookingPaymentSettings } from '../shared/bookingPayments.ts'
import { localPreview, type EmailEnv } from './email.ts'
import { bookingNotification } from './bookingNotifications.ts'
import { bookingLink } from './bookingLifecycle.ts'

type PublicOrganization = SubscriptionFields & {
  id: string; name: string; slug: string; description: string; contact_email: string
  phone: string; logo_url: string; brand_color: string; availability: string; booking_payment_settings: string; booking_change_hours: number
}
type PublicService = { id: string; name: string; duration_minutes: number; price_cents: number }
const unavailable = () => Response.json({ error: 'As marcações online estão temporariamente indisponíveis. Contacta o negócio.' }, { status: 403 })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function limits() {
  const now = businessNow()
  const date = new Date(`${now.slice(0, 10)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 90)
  return { now, today: now.slice(0, 10), maxDate: date.toISOString().slice(0, 10) }
}
const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))

async function throttle(db: D1Database, key: string, maximum: number): Promise<boolean> {
  const now = Date.now()
  const result = await db.prepare(`INSERT INTO auth_rate_limits (key, hits, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET hits = CASE WHEN reset_at <= ? THEN 1 ELSE hits + 1 END,
    reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END RETURNING hits`)
    .bind(key, now + 900_000, now, now).first<{ hits: number }>()
  return result!.hits <= maximum
}

async function replay(db: D1Database, org: string, key: string, fingerprint: string): Promise<Response | null> {
  const row = await db.prepare(`SELECT id, status, start_at, end_at, service_name_snapshot AS service_name,
    total_cents, online_due_cents, on_site_due_cents, payment_mode, public_request_hash
    FROM bookings WHERE organization_id = ? AND public_request_id = ?`).bind(org, key).first()
  if (!row) return null
  if (row.public_request_hash !== fingerprint) return Response.json({ error: 'Este pedido já foi utilizado. Atualiza a página antes de reservar.' }, { status: 409 })
  const { public_request_hash: _fingerprint, ...booking } = row
  void _fingerprint
  return Response.json({ booking, currency: 'EUR', payment_status: 'not_collected' }, { status: 201 })
}

export async function handlePublicBooking(request: Request, env: EmailEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/public/')) return null
  const match = url.pathname.match(/^\/api\/public\/([^/]+)(?:\/(slots|bookings))?$/)
  if (!match || !validSlug(match[1])) return Response.json({ error: 'Página não encontrada.' }, { status: 404 })
  const db = env.booking_saas_db
  const org = await db.prepare(`SELECT id, name, slug, description, contact_email, phone, logo_url, brand_color,
    availability, booking_payment_settings, booking_change_hours, trial_started_at, trial_ends_at, subscription_status, paid_until
    FROM organizations o WHERE slug = ? AND EXISTS (SELECT 1 FROM users u WHERE u.organization_id = o.id)`)
    .bind(match[1]).first<PublicOrganization>()
  if (!org) return Response.json({ error: 'Página não encontrada.' }, { status: 404 })
  const active = subscriptionAccess(org).can_manage
  const policy: BookingPaymentSettings = JSON.parse(org.booking_payment_settings)
  const calendar = limits()
  if (!match[2] && request.method === 'GET') {
    const { results } = active ? await db.prepare(`SELECT id, name, duration_minutes, price_cents
      FROM services WHERE organization_id = ? AND is_active = 1 ORDER BY name`).bind(org.id).all<PublicService>() : { results: [] }
    return Response.json({ business: { name: org.name, slug: org.slug, description: org.description,
      contact_email: org.contact_email, phone: org.phone, logo_url: org.logo_url, brand_color: org.brand_color },
      available: active, today: calendar.today, max_date: calendar.maxDate, time_zone: 'Europe/Lisbon', change_hours: org.booking_change_hours,
      services: results.map((service) => ({ ...service, payment: paymentQuote(service.price_cents, policy) })) })
  }
  if (match[2] === 'slots' && request.method === 'GET') {
    if (!active) return unavailable()
    const date = url.searchParams.get('date')
    const serviceId = url.searchParams.get('service_id')
    if (!validDate(date) || date < calendar.today || date > calendar.maxDate || !serviceId) {
      return Response.json({ error: 'Escolhe uma data válida nos próximos 90 dias e um serviço.' }, { status: 400 })
    }
    const service = await db.prepare('SELECT id, name, duration_minutes, price_cents FROM services WHERE id = ? AND organization_id = ? AND is_active = 1')
      .bind(serviceId, org.id).first<PublicService>()
    if (!service) return Response.json({ error: 'Serviço não encontrado.' }, { status: 404 })
    if (!paymentQuote(service.price_cents, policy).can_confirm_public_booking) return unavailable()
    const config: Availability = JSON.parse(org.availability)
    if (config.closures.some((closure) => date >= closure.start_date && date <= closure.end_date)) return Response.json({ slots: [] })
    const periods = config.weekly[new Date(`${date}T12:00:00Z`).getUTCDay()]
    const { results: booked } = await db.prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%S', start_at) AS start_at,
      strftime('%Y-%m-%dT%H:%M:%S', end_at) AS end_at FROM bookings WHERE organization_id = ? AND status != 'canceled'
      AND julianday(start_at) < julianday(?) AND julianday(end_at) > julianday(?)`)
      .bind(org.id, `${date}T23:59:59`, `${date}T00:00:00`).all<{ start_at: string; end_at: string }>()
    const slots: { start_time: string; end_time: string }[] = []
    for (const period of periods) {
      for (let start = minutes(period.start); start + service.duration_minutes <= minutes(period.end); start += 15) {
        const startAt = `${date}T${time(start)}:00`
        const endAt = `${date}T${time(start + service.duration_minutes)}:00`
        if (startAt > calendar.now && !booked.some((booking) => startAt < booking.end_at && endAt > booking.start_at)) {
          slots.push({ start_time: time(start), end_time: time(start + service.duration_minutes) })
        }
      }
    }
    return Response.json({ slots })
  }
  if (match[2] === 'bookings' && request.method === 'POST') {
    const body = await jsonBody(request)
    if (!body || typeof body.customer_name !== 'string' || !body.customer_name.trim() || body.customer_name.trim().length > 100 ||
        typeof body.customer_email !== 'string' || !validEmail(body.customer_email.trim()) ||
        typeof body.customer_phone !== 'string' || (body.customer_phone !== '' && !/^\+?[0-9 ()-]{6,30}$/.test(body.customer_phone)) ||
        typeof body.service_id !== 'string' || !validDate(body.date) ||
        typeof body.start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.start_time) ||
        typeof body.request_id !== 'string' || !/^[a-zA-Z0-9_-]{32,64}$/.test(body.request_id) ||
        typeof body.expected_price_cents !== 'number' || !Number.isSafeInteger(body.expected_price_cents) || body.expected_price_cents < 0 ||
        typeof body.expected_duration_minutes !== 'number' || !Number.isSafeInteger(body.expected_duration_minutes) || body.expected_duration_minutes <= 0 ||
        (body.website !== undefined && body.website !== '')) {
      return Response.json({ error: 'Verifica o nome, os contactos, o serviço e o horário.' }, { status: 400 })
    }
    const name = body.customer_name.trim()
    const email = body.customer_email.trim().toLowerCase()
    const phone = body.customer_phone.trim()
    const fingerprint = hash(JSON.stringify([name, email, phone, body.service_id, body.date, body.start_time, body.expected_price_cents, body.expected_duration_minutes]))
    const previous = await replay(db, org.id, body.request_id, fingerprint)
    if (previous) return previous
    if (!active) return unavailable()
    const startAt = `${body.date}T${body.start_time}:00`
    if (body.date < calendar.today || body.date > calendar.maxDate || startAt <= calendar.now) {
      return Response.json({ error: 'Escolhe um horário futuro nos próximos 90 dias.' }, { status: 400 })
    }
    if (!await throttle(db, `public-booking-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, 30) ||
        !await throttle(db, `public-booking-email:${org.id}:${hash(email)}`, 5)) {
      return Response.json({ error: 'Demasiados pedidos. Tenta novamente mais tarde ou contacta o negócio.' }, { status: 429, headers: { 'Retry-After': '900' } })
    }
    const id = crypto.randomUUID()
    const preview = localPreview(request, env)
    const management = bookingLink(env)
    const allowed = availabilityCondition('c.availability', 'c.start_at', 'c.end_at')
    const insert = db.prepare(`WITH candidate AS (
      SELECT s.id AS service_id, s.name AS service_name, s.price_cents, s.duration_minutes, o.id AS organization_id,
        o.availability, json_extract(o.booking_payment_settings, '$.mode') AS payment_mode,
        ? AS start_at, strftime('%Y-%m-%dT%H:%M:%S', ?, '+' || s.duration_minutes || ' minutes') AS end_at
      FROM services s JOIN organizations o ON o.id = s.organization_id
      WHERE s.id = ? AND s.organization_id = ? AND s.is_active = 1 AND s.price_cents = ? AND s.duration_minutes = ?
        AND ((o.trial_started_at <= ? AND o.trial_ends_at > ?) OR (o.subscription_status IN ('active', 'canceled') AND o.paid_until > ?))
        AND (json_extract(o.booking_payment_settings, '$.mode') = 'on_site' OR s.price_cents = 0)
    ) INSERT INTO bookings (id, organization_id, service_id, customer_name, customer_email, customer_phone,
      start_at, end_at, booking_source, total_cents, online_due_cents, on_site_due_cents, payment_mode,
      service_name_snapshot, public_request_id, public_request_hash, management_token_hash, management_expires_at)
    SELECT ?, c.organization_id, c.service_id, ?, ?, ?, c.start_at, c.end_at, 'public', c.price_cents, 0, c.price_cents,
      c.payment_mode, c.service_name, ?, ?, ?, ? FROM candidate c
    WHERE ${allowed} AND c.start_at > ?
      AND EXISTS (SELECT 1 FROM json_each(c.availability, '$.weekly[' || strftime('%w', c.start_at) || ']') slot
        WHERE substr(c.start_at, 12, 5) >= json_extract(slot.value, '$.start')
          AND substr(c.end_at, 12, 5) <= json_extract(slot.value, '$.end')
          AND ((strftime('%H', c.start_at) * 60 + strftime('%M', c.start_at)
            - (substr(json_extract(slot.value, '$.start'), 1, 2) * 60 + substr(json_extract(slot.value, '$.start'), 4, 2))) % 15) = 0)
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.organization_id = c.organization_id AND b.status != 'canceled'
        AND julianday(b.start_at) < julianday(c.end_at) AND julianday(b.end_at) > julianday(c.start_at)) RETURNING id`)
      .bind(startAt, startAt, body.service_id, org.id, body.expected_price_cents, body.expected_duration_minutes,
        Date.now(), Date.now(), Date.now(), id, name, email, phone, body.request_id, fingerprint, management.hash, management.expires, businessNow())
    try {
      const [created] = await db.batch([
        insert,
        bookingNotification(db, id, org.id, preview),
        db.prepare(`INSERT INTO email_outbox (id, organization_id, kind, payload, status)
          SELECT ?, b.organization_id, 'booking_confirmation', json_object('to', b.customer_email,
            'subject', 'Marcação confirmada — ' || o.name,
            'text', 'A tua marcação está confirmada.' || char(10) || 'Negócio: ' || o.name || char(10) ||
              'Serviço: ' || b.service_name_snapshot || char(10) || 'Data: ' || substr(b.start_at, 1, 10) || char(10) ||
              'Horário: ' || substr(b.start_at, 12, 5) || '–' || substr(b.end_at, 12, 5) || char(10) ||
              'A pagar no local: ' || printf('%.2f', b.on_site_due_cents / 100.0) || ' EUR' || char(10) ||
              'Referência: ' || b.id || char(10) || 'Cancelar ou reagendar: ' || ? || char(10) ||
              'Alterações online até ' || o.booking_change_hours || ' horas antes da marcação. Guarda este link em privado. Depois desse prazo, contacta o negócio.'), ?
          FROM bookings b JOIN organizations o ON o.id = b.organization_id WHERE b.id = ? AND b.organization_id = ?`)
          .bind(`booking-confirmed:${id}`, management.url, preview ? 'preview' : 'pending', id, org.id),
      ])
      if (!created.results.length) {
        const existing = await replay(db, org.id, body.request_id, fingerprint)
        if (existing) return existing
        return Response.json({ error: 'O horário, preço ou serviço deixou de estar disponível. Atualiza os horários antes de reservar.' }, { status: 409 })
      }
    } catch (error) {
      const existing = await replay(db, org.id, body.request_id, fingerprint)
      if (existing) return existing
      throw error
    }
    return (await replay(db, org.id, body.request_id, fingerprint))!
  }
  return Response.json({ error: 'Método não permitido.' }, { status: 405 })
}
