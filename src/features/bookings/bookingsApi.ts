import { secureFetch } from '../account/accountApi'
export type Booking = {
  id: string
  service_id: string
  service_name: string
  customer_name: string
  start_at: string
  end_at: string
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
  customer_name: string; service_id: string; date: string; start_time: string
}): Promise<Booking> {
  const response = await secureFetch('/api/bookings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  await check(response)
  return response.json()
}

export async function deleteBooking(id: string): Promise<void> {
  const response = await secureFetch(`/api/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await check(response)
}
