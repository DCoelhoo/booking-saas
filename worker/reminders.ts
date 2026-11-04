import type { EmailEnv } from './email.ts'
import { businessNow, businessTimestamp } from './businessTime.ts'

type Candidate = { id: string; organization_id: string; version: number; start_at: string; end_at: string;
  customer_email: string; service_name: string; staff_name: string; business_name: string; contact_email: string; phone: string; changed_at: string }

export async function queueBookingReminders(env: EmailEnv, now = Date.now(), organizationId: string | null = null): Promise<number> {
  const db = env.booking_saas_db
  const { results } = await db.prepare(`SELECT b.id, b.organization_id, b.version, b.start_at, b.end_at, b.customer_email,
    COALESCE(b.service_name_snapshot, s.name) AS service_name, (SELECT name FROM staff_members WHERE id=b.staff_id) AS staff_name, o.name AS business_name, o.contact_email, o.phone,
    COALESCE((SELECT e.created_at FROM booking_events e WHERE e.booking_id = b.id AND e.version = b.version), b.created_at) AS changed_at
    FROM bookings b JOIN organizations o ON o.id = b.organization_id JOIN services s ON s.id = b.service_id
    WHERE b.status = 'confirmed' AND b.customer_email != '' AND b.start_at > ? AND b.start_at <= ?
      AND (? IS NULL OR b.organization_id = ?)
      AND NOT EXISTS (SELECT 1 FROM email_outbox job WHERE job.id = 'booking-reminder:' || b.id || ':' || b.version)
    ORDER BY b.start_at, b.id LIMIT 100`)
    .bind(businessNow(new Date(now)), businessNow(new Date(now + 86_400_000)), organizationId, organizationId).all<Candidate>()
  if (!results.length) return 0
  const statements = results.map((b) => {
    const starts = businessTimestamp(b.start_at)
    const changed = Date.parse(`${b.changed_at.replace(' ', 'T')}Z`)
    // A booking created/moved less than 24 hours before the visit already has a fresh confirmation.
    const eligible = starts !== null && starts > now && Number.isFinite(changed) && changed <= starts - 86_400_000
    const payload = eligible ? JSON.stringify({ to: b.customer_email, subject: `Lembrete da tua marcação: ${b.business_name}`,
      text: `Lembramos a tua marcação.\n\nNegócio: ${b.business_name}\nServiço: ${b.service_name}\nColaborador: ${b.staff_name}\nData: ${b.start_at.slice(0, 10)}\nHorário: ${b.start_at.slice(11, 16)}–${b.end_at.slice(11, 16)} (hora de Lisboa)\nReferência: ${b.id}\n\nPara gerir a reserva, utiliza o link privado do email de confirmação ou contacta o negócio.\n${[b.contact_email, b.phone].filter(Boolean).join(' · ')}` }) : null
    return db.prepare(`INSERT OR IGNORE INTO email_outbox (id, organization_id, kind, payload, status, expires_at, booking_id, booking_version, booking_start_at)
      SELECT ?, organization_id, 'booking_reminder', ?, ?, ?, id, version, start_at FROM bookings
      WHERE id = ? AND organization_id = ? AND version = ? AND status = 'confirmed' AND start_at = ? AND end_at = ? AND customer_email = ?`)
      .bind(`booking-reminder:${b.id}:${b.version}`, payload, !eligible ? 'expired' : env.EMAIL_MODE === 'preview' ? 'preview' : 'pending',
        starts ?? now, b.id, b.organization_id, b.version, b.start_at, b.end_at, b.customer_email)
  })
  const jobs = await db.batch(statements)
  return jobs.reduce((count, job) => count + (job.meta.changes || 0), 0)
}
