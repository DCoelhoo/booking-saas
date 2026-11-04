import { useEffect, useState, type FormEvent } from 'react'
import { secureFetch } from './accountApi'
import { getBookingPaymentSettings, type BookingPaymentSettings as PaymentSettings } from './bookingPaymentApi'
import { paymentQuote } from '../../../shared/bookingPayments'

const euro = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })

export default function BookingPaymentSettings({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<PaymentSettings | null>(null)
  const [amount, setAmount] = useState('30')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    getBookingPaymentSettings().then((value) => {
      if (!cancelled) { setSettings(value); setAmount(String(value.deposit_type === 'fixed' ? value.deposit_value / 100 : value.deposit_value)); setError('') }
    }).catch(() => { if (!cancelled) setError('Não foi possível carregar as regras de pagamento.') })
    return () => { cancelled = true }
  }, [retry])

  const raw = Number(amount)
  const depositValue = settings?.deposit_type === 'fixed' ? Math.round(raw * 100) : raw
  const valid = settings?.mode !== 'deposit' || (amount.trim() !== '' && Number.isFinite(raw) &&
    Number.isSafeInteger(depositValue) && depositValue > 0 && (settings?.deposit_type === 'fixed' || depositValue < 100))
  const quote = settings && valid ? paymentQuote(5000, { ...settings, deposit_value: depositValue }) : null

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings || saving || !canManage) return
    setError(''); setNotice('')
    if (!valid) { setError('Indica um sinal válido: de 1% a 99%, ou um valor fixo superior a zero.'); return }
    setSaving(true)
    try {
      const response = await secureFetch('/api/booking-payment-settings', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, deposit_value: depositValue }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Não foi possível guardar as regras.')
      setSettings(data)
      setAmount(String(data.deposit_type === 'fixed' ? data.deposit_value / 100 : data.deposit_value))
      setNotice('Regras de pagamento guardadas. As cobranças online ainda não estão ativas.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível guardar as regras.') }
    finally { setSaving(false) }
  }
  function mode(value: PaymentSettings['mode']) {
    if (settings) setSettings({ ...settings, mode: value })
    setError(''); setNotice('')
  }
  return <details className="panel booking-payment-settings">
    <summary>Como os clientes pagam as marcações</summary>
    <p>Define a regra para os serviços do teu negócio. Esta configuração é independente da mensalidade da aplicação.</p>
    {!settings && !error && <p role="status">A carregar regras de pagamento...</p>}
    {!settings && error && <button type="button" className="secondary-button" onClick={() => setRetry((n) => n + 1)}>Tentar novamente</button>}
    {settings && <form className="account-form" onSubmit={save}>
      <fieldset disabled={saving || !canManage}>
        <legend>Pagamento das marcações</legend>
        <label className="payment-choice"><input type="radio" name="booking-payment-mode" checked={settings.mode === 'on_site'} onChange={() => mode('on_site')} />Pagamento no local</label>
        <small>O cliente reserva e paga o valor total no estabelecimento.</small>
        <label className="payment-choice"><input type="radio" name="booking-payment-mode" checked={settings.mode === 'full_online'} onChange={() => mode('full_online')} />Pagamento total online</label>
        <small>O cliente paga a totalidade para confirmar a reserva.</small>
        <label className="payment-choice"><input type="radio" name="booking-payment-mode" checked={settings.mode === 'deposit'} onChange={() => mode('deposit')} />Sinal online, restante no local</label>
        <small>O sinal é descontado do preço do serviço; não é uma taxa adicional.</small>
        {settings.mode === 'deposit' && <>
          <label htmlFor="deposit-type">Tipo de sinal</label>
          <select id="deposit-type" value={settings.deposit_type} onChange={(e) => {
            setSettings({ ...settings, deposit_type: e.target.value as PaymentSettings['deposit_type'] })
            setAmount(e.target.value === 'fixed' ? '10' : '30'); setNotice('')
          }}><option value="percentage">Percentagem do serviço</option><option value="fixed">Valor fixo em euros</option></select>
          <label htmlFor="deposit-value">{settings.deposit_type === 'fixed' ? 'Valor do sinal (€)' : 'Percentagem do sinal (%)'}</label>
          <input id="deposit-value" type="number" min={settings.deposit_type === 'fixed' ? '0.01' : '1'}
            max={settings.deposit_type === 'percentage' ? '99' : undefined} step={settings.deposit_type === 'fixed' ? 'any' : '1'}
            value={amount} onChange={(e) => { setAmount(e.target.value); setNotice('') }}
            onKeyDown={(e) => {
              if (settings.deposit_type !== 'fixed' || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
              e.preventDefault()
              if (!Number.isFinite(raw)) return
              setAmount((Math.max(1, Math.round(raw * 100) + (e.key === 'ArrowUp' ? 100 : -100)) / 100).toFixed(2))
              setNotice('')
            }} required />
          {settings.deposit_type === 'fixed' && <small>O sinal nunca ultrapassa o preço do serviço. Se o serviço custar menos, o cliente paga apenas esse total.</small>}
        </>}
        <button type="submit" className="primary-button">{saving ? 'A guardar...' : 'Guardar regras de pagamento'}</button>
      </fieldset>
      {quote && <div className="payment-example"><strong>Exemplo: serviço de 50 €</strong>
        <p>Online ao reservar: {euro.format(quote.online_due_cents / 100)} · No local: {euro.format(quote.on_site_due_cents / 100)}</p></div>}
      {settings.mode !== 'on_site' && <p>Regra preparada para a página pública. A cobrança online ainda não está disponível e será necessária para confirmar reservas com pagamento antecipado.</p>}
    </form>}
    {!canManage && <p>Podes consultar as regras. Para alterar, precisas de um teste ou subscrição ativa.</p>}
    {error && <p className="booking-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </details>
}
