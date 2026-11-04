import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { paymentQuote } from '../../../shared/bookingPayments'
import './PublicBookingPage.css'

type Service = { id: string; name: string; duration_minutes: number; price_cents: number; payment: ReturnType<typeof paymentQuote> }
type PageData = {
  business: { name: string; slug: string; description: string; contact_email: string; phone: string; logo_url: string; brand_color: string }
  available: boolean; today: string; max_date: string; time_zone: string; services: Service[]; staff: {id:string;name:string}[]; change_hours: number
}
type Slot = { start_time: string; end_time: string }
type Receipt = { booking: { id: string; status: string; staff_name: string; start_at: string; end_at: string; service_name: string; total_cents: number; on_site_due_cents: number } }
const euro = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })
const money = (cents: number) => euro.format(cents / 100)
const dateLabel = (date: string) => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

function brandInk(color: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179 ? '#000000' : '#ffffff'
}

export default function PublicBookingPage({ slug }: { slug: string }) {
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState('')
  const [stage, setStage] = useState(0)
  const [staffId, setStaffId] = useState('')
  const [slotData, setSlotData] = useState<{ key: string; slots: Slot[] } | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')
  const [slotsRetry, setSlotsRetry] = useState(0)
  const [choice, setChoice] = useState<Slot | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const request = useRef<{ fingerprint: string; id: string } | null>(null)
  const service = data?.services.find((item) => item.id === serviceId)
  const base = `/api/public/${encodeURIComponent(slug)}`

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setLoadError('')
      try {
        const response = await fetch(base)
        if (!response.ok) throw new Error(response.status === 404 ? 'Não encontrámos este negócio. Verifica o link que recebeste.' : 'Não foi possível carregar esta página.')
        const next: PageData = await response.json()
        if (!cancelled) { setData(next); setDate((current) => current && current >= next.today ? current : next.today); document.title = `${next.business.name} · Marcações` }
      } catch (cause) { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar esta página.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [base, refresh])

  useEffect(() => {
    if (!service || !staffId || !date || !service.payment.can_confirm_public_booking) return
    let cancelled = false
    async function load() {
      setSlotsLoading(true); setSlotsError('')
      try {
        const response = await fetch(`${base}/slots?staff_id=${encodeURIComponent(staffId)}&service_id=${encodeURIComponent(service!.id)}&date=${encodeURIComponent(date)}`)
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os horários.')
        if (!cancelled) setSlotData({ key: `${staffId}:${service!.id}:${date}`, slots: result.slots })
      } catch (cause) { if (!cancelled) setSlotsError(cause instanceof Error ? cause.message : 'Não foi possível carregar os horários.') }
      finally { if (!cancelled) setSlotsLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [base, service, staffId, date, slotsRetry])

  const slots = service && slotData?.key === `${staffId}:${service.id}:${date}` && !slotsLoading && !slotsError ? slotData.slots : []
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !service || !choice || !slots.some((slot) => slot.start_time === choice.start_time)) return
    setBusy(true); setError('')
    const input = { customer_name: name.trim(), customer_email: email.trim(), customer_phone: phone.trim(),
      staff_id: staffId, service_id: service.id, date, start_time: choice.start_time, expected_price_cents: service.price_cents,
      expected_duration_minutes: service.duration_minutes, website }
    const fingerprint = JSON.stringify(input)
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() }
    try {
      const response = await fetch(`${base}/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, request_id: request.current.id }) })
      const result = await response.json()
      if (!response.ok) {
        if ([403, 409].includes(response.status)) { setChoice(null); setStage(0); setRefresh((n) => n + 1) }
        throw new Error(result.error || 'Não foi possível confirmar. Tenta novamente.')
      }
      setReceipt(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar. Tenta novamente.') }
    finally { setBusy(false) }
  }

  if (loading) return <main className="public-loading"><p role="status">A carregar marcações...</p></main>
  if (loadError || !data) return <main className="public-loading"><h1>Não foi possível abrir a página</h1>
    <p role="alert">{loadError}</p><button type="button" onClick={() => setRefresh((n) => n + 1)}>Tentar novamente</button><a href="/">Área do negócio</a></main>
  const business = data.business
  const initials = business.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  return <div className="public-booking" style={{ '--public-brand': business.brand_color, '--public-ink': brandInk(business.brand_color) } as CSSProperties}>
    <header className="public-header"><a href={`/${business.slug}`} aria-label={business.name}>
      <span className="public-mark">{initials}</span><strong>{business.name}</strong></a><span>Marcações online</span></header>
    <main className="public-layout">
      <aside className="public-business">
        {business.logo_url && <img className="public-logo" src={business.logo_url} alt={`Logótipo de ${business.name}`} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.hidden = true }} />}
        <span className="public-eyebrow">O teu próximo compromisso</span>
        <h1>Reserva um momento<br />com {business.name}.</h1>
        <p className="public-description">{business.description || 'Escolhe o serviço e o horário que te dão mais jeito. Nós tratamos do resto.'}</p>
        <div className="public-facts"><p><strong>À tua medida</strong><span>Escolhe entre os horários disponíveis.</span></p><p><strong>Sem criar conta</strong><span>Precisamos apenas dos teus contactos.</span></p></div>
        {(business.contact_email || business.phone) && <section className="public-contact"><h2>Precisas de ajuda?</h2>
          {business.contact_email && <a href={`mailto:${business.contact_email}`}>{business.contact_email}</a>}
          {business.phone && <a href={`tel:${business.phone.replace(/[^+\d]/g, '')}`}>{business.phone}</a>}
        </section>}
      </aside>
      <section className="public-reservation" aria-label="Reservar uma marcação">
        {receipt ? <div className="public-success" role="status"><span className="public-success-symbol" aria-hidden="true">✓</span>
          <h2>{({ confirmed: 'Marcação confirmada', canceled: 'Marcação cancelada', completed: 'Marcação concluída', no_show: 'Falta de comparência registada' } as Record<string, string>)[receipt.booking.status]}</h2><p>{receipt.booking.service_name} · {receipt.booking.staff_name}</p>
          <strong>{dateLabel(receipt.booking.start_at.slice(0, 10))}</strong>
          <p>{receipt.booking.start_at.slice(11, 16)}–{receipt.booking.end_at.slice(11, 16)} · Hora de Lisboa</p>
          <p>{receipt.booking.on_site_due_cents > 0 ? `A pagar no local: ${money(receipt.booking.on_site_due_cents)}` : 'Serviço gratuito'}</p>
          <p>Guarda a referência para contactares o negócio.</p><code>{receipt.booking.id}</code>
          <p>Para cancelar ou reagendar, utiliza o link privado do email de confirmação. Se não receberes o email, contacta o negócio com esta referência.</p>
        </div> : !data.available ? <div className="public-empty"><h2>Marcações temporariamente indisponíveis</h2><p>Contacta o negócio para saberes mais.</p></div> : <>
          <ol className="public-steps" aria-label="Etapas da marcação">{['Colaborador', 'Serviço', 'Dia e hora', 'Confirmar'].map((label, i) => <li key={label} aria-current={stage === i ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
          {error && <p className="public-error" role="alert">{error}</p>}
          {stage === 0 && <><h2>Com quem queres marcar?</h2><p>Escolhe um colaborador do estabelecimento.</p><div className="public-services">{data.staff.map(m=><button type="button" className="public-service" key={m.id} onClick={()=>{setStaffId(m.id);setChoice(null);setStage(1);setError('')}}><strong>{m.name}</strong><span>Escolher →</span></button>)}</div>{data.staff.length===0&&<p>Não existem colaboradores disponíveis. Contacta o estabelecimento.</p>}</>}
          {stage === 1 && <><button type="button" className="public-secondary" onClick={()=>setStage(0)}>Alterar colaborador</button><p>Com {data.staff.find(m=>m.id===staffId)?.name}</p><h2>O que vamos marcar?</h2><p>Começa por escolher um serviço.</p>
            <div className="public-services">{data.services.map((item) => <button type="button" key={item.id}
              className={`public-service ${serviceId === item.id ? 'is-selected' : ''}`} aria-pressed={serviceId === item.id}
              disabled={!item.payment.can_confirm_public_booking || busy}
              onClick={() => { setServiceId(item.id); setChoice(null); setError('') }}>
              <span><strong>{item.name}</strong><small>{item.duration_minutes} minutos</small>
                {!item.payment.can_confirm_public_booking && <small>Reservas online temporariamente indisponíveis. Contacta o negócio.</small>}</span>
              <strong>{item.price_cents === 0 ? 'Gratuito' : money(item.price_cents)}</strong>
            </button>)}</div>
            {data.services.length === 0 && <p>Ainda não existem serviços disponíveis para marcação online.</p>}
            <button type="button" className="public-primary" disabled={!service || busy} onClick={() => setStage(2)}>Escolher dia e hora →</button>
          </>}
          {stage === 2 && service && <><h2>Quando te dá jeito?</h2><p>{service.name} · {service.duration_minutes} minutos</p>
            <label className="public-field" htmlFor="public-date">Dia<input id="public-date" type="date" value={date} min={data.today} max={data.max_date}
              onChange={(e) => { setDate(e.target.value); setChoice(null); setError('') }} disabled={busy} required /></label>
            <p className="public-timezone">Horários na hora de Lisboa · Europe/Lisbon</p>
            {slotsLoading && <p role="status">A procurar horários livres...</p>}
            {slotsError && <div><p className="public-error" role="alert">{slotsError}</p><button type="button" className="public-secondary" onClick={() => setSlotsRetry((n) => n + 1)}>Tentar novamente</button></div>}
            {!slotsLoading && !slotsError && slots.length === 0 && <p>Não existem horários livres nesta data. Escolhe outro dia.</p>}
            <div className="public-slots">{slots.map((slot) => <button type="button" key={slot.start_time} aria-pressed={choice?.start_time === slot.start_time}
              className={choice?.start_time === slot.start_time ? 'is-selected' : ''} onClick={() => setChoice(slot)}>{slot.start_time}</button>)}</div>
            <div className="public-actions"><button type="button" className="public-secondary" onClick={() => setStage(1)}>Voltar</button>
              <button type="button" className="public-primary" disabled={!choice || slotsLoading || !!slotsError} onClick={() => setStage(3)}>Continuar →</button></div>
          </>}
          {stage === 3 && service && choice && <><h2>Está quase.</h2><p>Confirma a marcação e deixa os teus contactos.</p>
            <div className="public-summary"><strong>{service.name}</strong><span>Com {data.staff.find(m=>m.id===staffId)?.name}</span><span>{dateLabel(date)}</span><span>{choice.start_time}–{choice.end_time} · Hora de Lisboa</span>
              <strong>{service.price_cents === 0 ? 'Gratuito' : `${money(service.price_cents)} · Pagamento no local`}</strong></div>
            <p>Podes cancelar ou reagendar pelo link privado do email até {data.change_hours} horas antes da marcação. Depois desse prazo, contacta o negócio.</p>
            <form onSubmit={submit}><fieldset disabled={busy}>
              <label className="public-field" htmlFor="public-name">Nome<input id="public-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} required /></label>
              <label className="public-field" htmlFor="public-email">Email<input id="public-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required /></label>
              <label className="public-field" htmlFor="public-phone">Telefone (opcional)<input id="public-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" minLength={6} maxLength={30} /></label>
              <div className="public-trap" aria-hidden="true"><label>Website<input value={website} onChange={(e) => setWebsite(e.target.value)} autoComplete="off" tabIndex={-1} /></label></div>
              <p className="public-data-note">Os teus contactos serão usados para gerir esta marcação.</p>
              <div className="public-actions"><button type="button" className="public-secondary" onClick={() => setStage(2)}>Voltar</button>
                <button type="submit" className="public-primary">{busy ? 'A confirmar...' : 'Confirmar marcação'}</button></div>
            </fieldset></form>
          </>}
        </>}
      </section>
    </main>
    <footer className="public-footer"><span>Marcações com Booking SaaS</span><a href="/">Área do negócio</a></footer>
  </div>
}
