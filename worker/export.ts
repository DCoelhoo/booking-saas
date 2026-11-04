import type { D1Database } from '@cloudflare/workers-types'
import type { Account } from './auth.ts'

export async function exportData(db: D1Database, account: Account): Promise<Response> {
  const [services, bookings] = await db.batch([
    db.prepare(`SELECT id, name, duration_minutes, price_cents, is_active, created_at
      FROM services WHERE organization_id = ? ORDER BY name, id`).bind(account.organization.id),
    db.prepare(`SELECT b.id, b.service_id, s.name AS service_name, b.customer_name, b.start_at, b.end_at, b.created_at
      FROM bookings b JOIN services s ON s.id = b.service_id AND s.organization_id = b.organization_id
      WHERE b.organization_id = ? ORDER BY b.start_at, b.id`).bind(account.organization.id),
  ])
  const exportedAt = new Date().toISOString()
  return new Response(JSON.stringify({ exported_at: exportedAt, account,
    services: services.results, bookings: bookings.results }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="booking-data-${exportedAt.slice(0, 10)}.json"` },
  })
}
