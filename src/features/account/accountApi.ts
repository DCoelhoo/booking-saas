import { notifyPublicPageUpdate } from '../public/previewUpdates'
export type Account = {
  subscription: {
    status: 'trialing' | 'active' | 'expired'; can_manage: boolean
    trial_ends_at: number; access_until: number; days_remaining: number
    monthly_price_cents: number; currency: string; billing_available: boolean
  }
  user: { id: string; email: string; full_name: string; role: 'owner' | 'staff'; staff_id: string | null; photo_url: string }
  organization: {
    id: string; name: string; slug: string; description: string; contact_email: string
    phone: string; brand_color: string; logo_url: string; cover_url: string; profile_photo_url: string
  }
}

export async function secureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { ...init, credentials: 'same-origin' })
  if (response.status === 401) window.dispatchEvent(new Event('session-expired'))
  if (response.status === 402) window.dispatchEvent(new Event('subscription-expired'))
  if (response.ok && init?.method && !['GET', 'HEAD'].includes(init.method)) { window.dispatchEvent(new Event('email-preview-updated')); notifyPublicPageUpdate() }
  return response
}

export async function accountRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    if (response.status === 402) window.dispatchEvent(new Event('subscription-expired'))
    const data = await response.json().catch(() => null)
    if (response.status === 401 && !['auth/session', 'auth/login'].includes(path)) {
      window.dispatchEvent(new Event('session-expired'))
    }
    throw new Error(data?.error || 'Não foi possível concluir o pedido.')
  }
  if (!['GET', 'HEAD'].includes(method)) { window.dispatchEvent(new Event('email-preview-updated')); notifyPublicPageUpdate() }
  return response.status === 204 ? undefined as T : response.json()
}

export async function currentAccount(): Promise<Account | null> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Não foi possível verificar a sessão.')
  return response.json()
}
