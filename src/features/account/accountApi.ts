export type Account = {
  user: { id: string; email: string; full_name: string }
  organization: {
    id: string; name: string; slug: string; description: string; contact_email: string
    phone: string; brand_color: string; logo_url: string
  }
}

export async function secureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { ...init, credentials: 'same-origin' })
  if (response.status === 401) window.dispatchEvent(new Event('session-expired'))
  return response
}

export async function accountRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    if (response.status === 401 && !['auth/session', 'auth/login'].includes(path)) {
      window.dispatchEvent(new Event('session-expired'))
    }
    throw new Error(data?.error || 'Não foi possível concluir o pedido.')
  }
  return response.status === 204 ? undefined as T : response.json()
}

export async function currentAccount(): Promise<Account | null> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Não foi possível verificar a sessão.')
  return response.json()
}
