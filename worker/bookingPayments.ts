import type { D1Database } from '@cloudflare/workers-types'
import { jsonBody } from './auth.ts'
import { paymentQuote, validatePaymentSettings, type BookingPaymentSettings } from '../shared/bookingPayments.ts'

export async function handleBookingPaymentSettings(request: Request, db: D1Database, organizationId: string): Promise<Response> {
  if (request.method === 'GET') {
    const row = await db.prepare('SELECT booking_payment_settings FROM organizations WHERE id = ?')
      .bind(organizationId).first<{ booking_payment_settings: string }>()
    return Response.json(JSON.parse(row!.booking_payment_settings))
  }
  if (request.method !== 'PUT') return Response.json({ error: 'Método não permitido.' }, { status: 405 })
  const settings = validatePaymentSettings(await jsonBody(request))
  if (!settings) return Response.json({ error: 'Escolhe o modo de pagamento e um sinal entre 1% e 99%, ou um valor fixo superior a zero.' }, { status: 400 })
  await db.prepare('UPDATE organizations SET booking_payment_settings = ? WHERE id = ?')
    .bind(JSON.stringify(settings), organizationId).run()
  return Response.json(settings)
}

export async function servicePaymentQuote(db: D1Database, organizationId: string, serviceId: string, canManage: boolean): Promise<Response> {
  const row = await db.prepare(`SELECT s.price_cents, o.booking_payment_settings FROM services s
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.id = ? AND s.organization_id = ? AND s.is_active = 1`)
    .bind(serviceId, organizationId).first<{ price_cents: number; booking_payment_settings: string }>()
  if (!row) return Response.json({ error: 'Serviço não encontrado.' }, { status: 404 })
  const settings: BookingPaymentSettings = JSON.parse(row.booking_payment_settings)
  const quote = paymentQuote(row.price_cents, settings)
  return Response.json({ service_id: serviceId, ...quote, can_confirm_public_booking: canManage && quote.can_confirm_public_booking })
}
