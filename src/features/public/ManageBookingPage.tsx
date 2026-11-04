import { useEffect, useState } from 'react'
import './PublicBookingPage.css'

type Data = {
  booking: { id: string; service_name: string; staff_name: string; status: string; version: number; start_at: string; end_at: string }
  business: { name: string; contact_email: string; phone: string }
  can_cancel: boolean; can_reschedule: boolean; change_hours: number; today: string; max_date: string
}
type Slot = { start_time: string; end_time: string }
const labels: Record<string, string> = { confirmed: 'Confirmada', completed: 'Concluída', canceled: 'Cancelada', no_show: 'Não compareceu' }
const dayLabel = (s: string) => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${s.slice(0, 10)}T12:00:00Z`))

export default function ManageBookingPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule'>('view')
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState<Slot | null>(null)
  const [slots, setSlots] = useState<{ date: string; items: Slot[] } | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')
  const [slotsRetry, setSlotsRetry] = useState(0)

  useEffect(() => {
    let canceled = false
    async function load() {
    setLoadError('')
    await fetch('/api/booking-management', { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => {
      const result = await r.json(); if (!r.ok) throw Error(result.error)
      if (!canceled) { setData(result); setDate(result.booking.start_at.slice(0, 10)); document.title = `Gerir marcação · ${result.business.name}` }
    }).catch((e: Error) => { if (!canceled) setLoadError(e.message || 'Não foi possível carregar a marcação.') })
    }
    void load()
    return () => { canceled = true }
  }, [token, reload])
  useEffect(() => {
    if (mode !== 'reschedule' || !date) return
    let canceled = false
    async function load() {
    setSlotsLoading(true); setSlotsError('')
    await fetch(`/api/booking-management/slots?date=${encodeURIComponent(date)}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => {
      const result = await r.json(); if (!r.ok) throw Error(result.error)
      if (!canceled) setSlots({ date, items: result.slots })
    }).catch((e: Error) => { if (!canceled) setSlotsError(e.message || 'Não foi possível carregar os horários.') })
      .finally(() => { if (!canceled) setSlotsLoading(false) })
    }
    void load()
    return () => { canceled = true }
  }, [mode, date, token, slotsRetry])

  async function change(action: 'canceled' | 'reschedule') {
    if (!data || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/booking-management', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, version: data.booking.version, date, start_time: slot?.start_time }) })
      const result = await response.json()
      if (!response.ok) throw Error(result.error)
      setData((current) => current ? { ...current, booking: { ...current.booking, ...result }, can_cancel: false, can_reschedule: false } : current)
      setNotice(action === 'canceled' ? 'Marcação cancelada. O horário foi libertado.' : 'Marcação reagendada com sucesso. O preço acordado mantém-se.')
      setMode('view'); setSlot(null); setReload((n) => n + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a marcação.')
      setMode('view'); setSlot(null); setReload((n) => n + 1)
    } finally { setBusy(false) }
  }
  return <div className="public-page"><header className="public-header"><strong>Gerir a tua marcação</strong><span>Sem criar conta</span></header>
    <main className="public-layout"><aside className="public-intro"><p className="public-eyebrow">A TUA MARCAÇÃO</p>
      <h1>{data?.business.name || 'Consulta e gere a tua reserva.'}</h1>
      {data && <section className="public-contact"><h2>Precisas de ajuda?</h2>
        {data.business.contact_email && <a href={`mailto:${data.business.contact_email}`}>{data.business.contact_email}</a>}
        {data.business.phone && <a href={`tel:${data.business.phone.replace(/[^+\d]/g, '')}`}>{data.business.phone}</a>}
      </section>}
    </aside><section className="public-reservation" aria-label="Gerir marcação">
      {loadError ? <><h2>Não foi possível abrir a marcação</h2><p role="alert">{loadError}</p><button className="public-secondary" onClick={() => setReload((n) => n + 1)}>Tentar novamente</button></> : !data ? <p role="status">A carregar marcação...</p> : <>
        <h2>{data.booking.service_name}</h2><p>Com {data.booking.staff_name}</p><p><strong>{labels[data.booking.status]}</strong></p>
        <div className="public-summary"><strong>{dayLabel(data.booking.start_at)}</strong><span>{data.booking.start_at.slice(11, 16)}–{data.booking.end_at.slice(11, 16)} · Hora de Lisboa</span><small>Referência: {data.booking.id}</small></div>
        {notice && <p role="status">{notice}</p>}{error && <p className="public-error" role="alert">{error}</p>}
        {data.booking.status === 'confirmed' && <p>Podes cancelar ou reagendar até {data.change_hours} horas antes da marcação. Depois desse prazo, contacta o negócio.</p>}
        {mode === 'view' && <div className="public-actions">
          {data.can_reschedule && <button className="public-primary" disabled={busy} onClick={() => { setMode('reschedule'); setError(''); setNotice('') }}>Reagendar</button>}
          {data.can_cancel && <button className="public-secondary" disabled={busy} onClick={() => { setMode('cancel'); setError(''); setNotice('') }}>Cancelar marcação</button>}
          {!data.can_cancel && data.booking.status === 'confirmed' && <p>As alterações online estão encerradas. Contacta o negócio.</p>}
        </div>}
        {mode === 'cancel' && <><h3>Queres cancelar esta marcação?</h3><p>O horário ficará disponível para outras pessoas.</p><div className="public-actions">
          <button className="public-secondary" disabled={busy} onClick={() => setMode('view')}>Manter marcação</button>
          <button className="public-primary" disabled={busy} onClick={() => void change('canceled')}>{busy ? 'A cancelar...' : 'Confirmar cancelamento'}</button>
        </div></>}
        {mode === 'reschedule' && <><h3>Escolhe o novo horário</h3><label className="public-field">Novo dia<input type="date" min={data.today} max={data.max_date} value={date} disabled={busy} onChange={(e) => { setDate(e.target.value); setSlot(null) }} /></label>
          {slotsLoading && <p role="status">A procurar horários...</p>}
          {slotsError && <><p role="alert">{slotsError}</p><button className="public-secondary" onClick={() => setSlotsRetry((n) => n + 1)}>Tentar novamente</button></>}
          {!slotsLoading && !slotsError && slots?.date === date && <div className="public-slots">{slots.items.filter((s) => `${date}T${s.start_time}:00` !== data.booking.start_at).map((s) => <button key={s.start_time} disabled={busy} aria-pressed={slot?.start_time === s.start_time} className={slot?.start_time === s.start_time ? 'is-selected' : ''} onClick={() => setSlot(s)}>{s.start_time}</button>)}{slots.items.length === 0 && <p>Não existem horários livres. Escolhe outro dia.</p>}</div>}
          {slot && <p>Novo horário: <strong>{dayLabel(date)} · {slot.start_time}–{slot.end_time}</strong>. O preço acordado mantém-se.</p>}
          <div className="public-actions"><button className="public-secondary" disabled={busy} onClick={() => { setMode('view'); setSlot(null) }}>Voltar</button>
            <button className="public-primary" disabled={busy || !slot || slotsLoading || !!slotsError || slots?.date !== date} onClick={() => void change('reschedule')}>{busy ? 'A reagendar...' : 'Confirmar novo horário'}</button></div>
        </>}
      </>}
    </section></main><footer className="public-footer"><span>Guarda este link em privado: permite gerir a tua marcação.</span></footer></div>
}
