export type BookingPaymentSettings = {
  mode: 'on_site' | 'full_online' | 'deposit'
  deposit_type: 'percentage' | 'fixed'
  deposit_value: number
}

export function validatePaymentSettings(value: unknown): BookingPaymentSettings | null {
  if (!value || typeof value !== 'object' || !('mode' in value)) return null
  if (value.mode === 'on_site' || value.mode === 'full_online') {
    return { mode: value.mode, deposit_type: 'percentage', deposit_value: 30 }
  }
  if (value.mode !== 'deposit' || !('deposit_type' in value) || !('deposit_value' in value) ||
      typeof value.deposit_value !== 'number' || !Number.isSafeInteger(value.deposit_value) || value.deposit_value <= 0) return null
  if (value.deposit_type === 'percentage' && value.deposit_value < 100) {
    return { mode: 'deposit', deposit_type: 'percentage', deposit_value: value.deposit_value }
  }
  if (value.deposit_type === 'fixed') return { mode: 'deposit', deposit_type: 'fixed', deposit_value: value.deposit_value }
  return null
}

export function paymentQuote(priceCents: number, settings: BookingPaymentSettings) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error('Preço inválido.')
  let online = 0
  if (settings.mode === 'full_online') online = priceCents
  if (settings.mode === 'deposit' && priceCents > 0) {
    const amount = settings.deposit_type === 'fixed' ? settings.deposit_value
      : Math.floor(priceCents / 100) * settings.deposit_value + Math.round((priceCents % 100) * settings.deposit_value / 100)
    online = Math.min(priceCents, Math.max(1, amount))
  }
  return {
    mode: settings.mode, currency: 'EUR', total_cents: priceCents,
    online_due_cents: online, on_site_due_cents: priceCents - online,
    requires_online_payment: online > 0,
    online_payments_available: false,
    can_confirm_public_booking: online === 0,
  }
}
