
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

