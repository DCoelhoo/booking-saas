import { secureFetch } from './accountApi'

export type Availability = {
  weekly: { start: string; end: string }[][]
  closures: { start_date: string; end_date: string; reason: string }[]
}

export async function getAvailability(): Promise<Availability> {
  const response = await secureFetch('/api/availability')
  if (!response.ok) throw new Error('Não foi possível carregar os horários.')
  return response.json()
}
