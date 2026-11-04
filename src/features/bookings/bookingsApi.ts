import { secureFetch } from '../account/accountApi'
export type Booking = {
  staff_id: string
  staff_name: string
  status: 'confirmed' | 'completed' | 'canceled' | 'no_show'
  version: number
  id: string
  service_id: string
  service_name: string
  customer_name: string
  start_at: string
  end_at: string
  customer_email?: string
  customer_phone?: string
  booking_source?: string
  total_cents?: number | null
  on_site_due_cents?: number | null
}

async function check(response: Response): Promise<void> {
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || 'Não foi possível concluir a operação.')
  }
}

export async function getBookings(date: string): Promise<Booking[]> {
  const response = await secureFetch(`/api/bookings?date=${encodeURIComponent(date)}`)
  await check(response)
  return (await response.json()).bookings
}

export async function createBooking(input: {
  customer_name: string; service_id: string; date: string; start_time: string; staff_id: string
}): Promise<Booking> {
  const response = await secureFetch('/api/bookings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  await check(response)
  return response.json()
}

export async function updateBookingStatus(booking: Booking, status: Booking['status']): Promise<void> {
  const response = await secureFetch(`/api/bookings/${encodeURIComponent(booking.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, version: booking.version }),
  })
  await check(response)
}
