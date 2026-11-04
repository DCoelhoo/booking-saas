import { secureFetch } from './accountApi'
export type { BookingPaymentSettings } from '../../../shared/bookingPayments'
import type { BookingPaymentSettings } from '../../../shared/bookingPayments'

export async function getBookingPaymentSettings(): Promise<BookingPaymentSettings> {
  const response = await secureFetch('/api/booking-payment-settings')
  if (!response.ok) throw new Error('Não foi possível carregar as regras de pagamento.')
  return response.json()
}
