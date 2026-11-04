export type SubscriptionFields = {
  trial_started_at: number
  trial_ends_at: number
  subscription_status: 'inactive' | 'active' | 'past_due' | 'canceled'
  paid_until: number
}

export function subscriptionAccess(fields: SubscriptionFields, now = Date.now()) {
  const paid = ['active', 'canceled'].includes(fields.subscription_status) && fields.paid_until > now
  const trial = fields.trial_started_at <= now && fields.trial_ends_at > now
  const status = paid ? 'active' : trial ? 'trialing' : 'expired'
  const accessUntil = paid ? fields.paid_until : fields.trial_ends_at
  return {
    status,
    can_manage: paid || trial,
    trial_ends_at: fields.trial_ends_at,
    access_until: accessUntil,
    days_remaining: Math.max(0, Math.ceil((accessUntil - now) / 86_400_000)),
    monthly_price_cents: 1000,
    currency: 'EUR',
    billing_available: false,
  }
}

export const subscriptionRequired = () => Response.json({
  code: 'SUBSCRIPTION_REQUIRED',
  error: 'O período de teste terminou. É necessária uma subscrição para criar marcações ou alterar os serviços e a personalização. Podes continuar a consultar, cancelar e exportar os teus dados.',
}, { status: 402 })
