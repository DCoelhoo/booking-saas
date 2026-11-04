import type { D1Database } from '@cloudflare/workers-types'
import type { Account } from './auth.ts'

export async function exportData(db: D1Database, account: Account): Promise<Response> {
  const [services, bookings, availability, events] = await db.batch([
    db.prepare(`SELECT id, name, duration_minutes, price_cents, is_active, created_at
      FROM services WHERE organization_id = ? ORDER BY name, id`).bind(account.organization.id),
    db.prepare(`SELECT b.id, b.service_id, COALESCE(b.service_name_snapshot, s.name) AS service_name,
      b.staff_id, (SELECT name FROM staff_members WHERE id=b.staff_id) AS staff_name, b.status, b.version, b.customer_name, b.customer_email, b.customer_phone, b.booking_source,
      b.total_cents, b.online_due_cents, b.on_site_due_cents, b.payment_mode, b.start_at, b.end_at, b.created_at
      FROM bookings b JOIN services s ON s.id = b.service_id AND s.organization_id = b.organization_id
      WHERE b.organization_id = ? ORDER BY b.start_at, b.id`).bind(account.organization.id),
    db.prepare('SELECT availability, booking_payment_settings, booking_change_hours FROM organizations WHERE id = ?').bind(account.organization.id),
    db.prepare(`SELECT booking_id, actor, kind, previous_start_at, previous_end_at, start_at, end_at, status, version, created_at
      FROM booking_events WHERE organization_id = ? ORDER BY created_at, id`).bind(account.organization.id),
  ])
  const exportedAt = new Date().toISOString()
  return new Response(JSON.stringify({ exported_at: exportedAt, account,
    availability: JSON.parse((availability.results[0] as { availability: string }).availability),
    booking_payment_settings: JSON.parse((availability.results[0] as { booking_payment_settings: string }).booking_payment_settings),
    booking_change_hours: (availability.results[0] as { booking_change_hours: number }).booking_change_hours,
    services: services.results, bookings: bookings.results, booking_events: events.results }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="booking-data-${exportedAt.slice(0, 10)}.json"` },
  })
}
