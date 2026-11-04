
export type Service = {
  id: string
  name: string
  duration_minutes: number
  price_cents: number
  is_active: number
}

type ServicesResponse = {
  services: Service[]
}

export async function getServices(): Promise<Service[]> {
  const response = await fetch('/api/services')

  if (!response.ok) {
    throw new Error('Erro ao carregar os serviços')
  }

  const data: ServicesResponse = await response.json()

  return data.services
}


export type CreateServiceInput = {
  name: string
  duration_minutes: number
  price_cents: number
}

export type UpdateServiceInput = Partial<CreateServiceInput> & {
  is_active?: 0 | 1
  apply_to_future_bookings?: boolean
  bookings_snapshot?: string
}

export type DurationPreview = {
  bookings: { id: string; customer_name: string; start_at: string; end_at: string; proposed_end: string | null }[]
  snapshot: string
  has_conflicts: boolean
}

export async function previewDuration(id: string, duration: number): Promise<DurationPreview> {
  const response = await fetch(`/api/services/${encodeURIComponent(id)}/duration-preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duration_minutes: duration }),
  })
  if (!response.ok) throw new Error('Não foi possível verificar as marcações.')
  return response.json()
}

export async function updateService(id: string, input: UpdateServiceInput): Promise<Service> {
  const response = await fetch(`/api/services/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || 'Não foi possível atualizar o serviço.')
  }

  return (await response.json()) as Service
}

export async function createService(
  input: CreateServiceInput
): Promise<Service> {
  const response = await fetch('/api/services', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error('Não foi possível criar o serviço.')
  }

  return (await response.json()) as Service
}

