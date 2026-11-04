import type { D1Database } from '@cloudflare/workers-types'

export function bookingNotification(db: D1Database, bookingId: string, organizationId: string, preview: boolean) {
  return db.prepare(`INSERT INTO email_outbox (id, organization_id, kind, payload, status)
    SELECT ?, b.organization_id, 'booking_created', json_object(
      'to', CASE WHEN o.contact_email != '' THEN o.contact_email ELSE u.email END,
      'subject', 'Nova marcação — ' || o.name,
      'text', 'Recebeste uma nova marcação.' || char(10) || char(10) ||
        'Cliente: ' || b.customer_name || char(10) || 'Email: ' || b.customer_email || char(10) ||
        'Telefone: ' || b.customer_phone || char(10) || 'Serviço: ' || s.name || char(10) ||
        'Data: ' || substr(b.start_at, 1, 10) || char(10) ||
        'Horário: ' || substr(b.start_at, 12, 5) || '–' || substr(b.end_at, 12, 5) || char(10) ||
        'As horas correspondem ao horário local do negócio.'), ?
    FROM bookings b JOIN organizations o ON o.id = b.organization_id
    JOIN users u ON u.organization_id = b.organization_id
    JOIN services s ON s.id = b.service_id AND s.organization_id = b.organization_id
    WHERE b.id = ? AND b.organization_id = ?`)
    .bind(`booking-created:${bookingId}`, preview ? 'preview' : 'pending', bookingId, organizationId)
}
