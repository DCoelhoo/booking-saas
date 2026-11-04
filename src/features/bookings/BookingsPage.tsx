import { useEffect, useState, type FormEvent } from 'react'
import { getServices, type Service } from '../services/servicesApi'
import { getBookings, createBooking, updateBookingStatus, type Booking } from './bookingsApi'
import { getAvailability, type Availability } from '../account/availabilityApi'
import { getBookingPaymentSettings, type BookingPaymentSettings } from '../account/bookingPaymentApi'
import { paymentQuote } from '../../../shared/bookingPayments'
import './BookingsPage.css'
import { getStaff, type Staff } from '../account/staffApi'

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function BookingsPage({ canManage, ownAgenda = false }: { canManage: boolean; ownAgenda?: boolean }) {
  const [selectedDate, setSelectedDate] = useState(() => localDate(new Date()))
  const [data, setData] = useState<{ date: string; bookings: Booking[]; services: Service[]; availability: Availability; paymentSettings: BookingPaymentSettings; staff: Staff[] } | null>(null)
  const [staffFilter, setStaffFilter] = useState('')
  const [bookingStaff, setBookingStaff] = useState('')
  const [reload, setReload] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [customer, setCustomer] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const [bookings, services, availability, paymentSettings, staff] = await Promise.all([getBookings(selectedDate), getServices(), getAvailability(), getBookingPaymentSettings(), getStaff()])
        if (!cancelled) setData({ date: selectedDate, bookings, services: services.filter((s) => s.is_active === 1), availability, paymentSettings, staff })
      } catch {
        if (!cancelled) setLoadError('Não foi possível carregar a agenda. Tenta novamente.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [selectedDate, reload])

  const ready = !loading && !loadError && data?.date === selectedDate
  const services = ready ? data.services : []
  const bookings = ready ? data.bookings.filter(b=>!staffFilter || b.staff_id===staffFilter) : []
  const now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T')
  const selectedService = services.find((s) => s.id === serviceId)
  const quote = selectedService && ready ? paymentQuote(selectedService.price_cents, data.paymentSettings) : null
  const euro = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })
  const weekday = new Date(`${selectedDate}T12:00:00Z`).getUTCDay()
  const closed = ready && data.availability.closures.some((period) => selectedDate >= period.start_date && selectedDate <= period.end_date)
  const periods = ready && !closed ? data.availability.weekly[weekday] : []
  const [hours, minutes] = startTime.split(':').map(Number)
  const endMinutes = hours * 60 + minutes + (selectedService?.duration_minutes ?? 0)
  const endTime = Number.isFinite(endMinutes) && endMinutes < 1440
    ? `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}` : '—'

  function selectDate(value: string) {
    if (!value || busy) return
    setSelectedDate(value)
    setShowForm(false)
    setError('')
    setNotice('')
  }

  function changeDay(offset: number) {
    const date = new Date(`${selectedDate}T12:00:00`)
    date.setDate(date.getDate() + offset)
    selectDate(localDate(date))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !ready || !canManage) return
    setError('')
    setNotice('')
    if (!selectedService || !customer.trim()) {
      setError('Indica o nome do cliente e um serviço ativo.')
      return
    }
    setBusy(true)
    try {
      const booking = await createBooking({ customer_name: customer.trim(), service_id: serviceId, date: selectedDate, start_time: startTime, staff_id: bookingStaff })
      setData((current) => current && ({ ...current, bookings: [...current.bookings, booking].sort((a, b) => a.start_at.localeCompare(b.start_at)) }))
      setCustomer('')
      setStartTime('09:00')
      setShowForm(false)
      setNotice('Marcação guardada com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível guardar a marcação.')
      setReload((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(booking: Booking, status: Booking['status']) {
    const labels = { confirmed: 'Confirmada', completed: 'Concluída', canceled: 'Cancelada', no_show: 'Não compareceu' }
    if (busy || !window.confirm(`Alterar a marcação de ${booking.customer_name} para «${labels[status]}»?`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await updateBookingStatus(booking, status)
      setReload((value) => value + 1)
      setNotice(`Marcação atualizada: ${labels[status]}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a marcação.')
      setReload((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bookings-page">
      <div className="bookings-heading">
        <div><h2>{ownAgenda ? 'A tua agenda' : 'Agenda'}</h2><p>{ownAgenda ? 'Consulta e gere as tuas marcações.' : 'Gere as marcações do teu negócio.'}</p></div>
        <button type="button" className="primary-button" disabled={!canManage || !ready || busy || showForm || services.length === 0 || periods.length === 0}
          onClick={() => { setError(''); setNotice(''); setBookingStaff(staffFilter || data!.staff.find(m=>m.is_active)?.id || ''); setServiceId(services[0].id); setStartTime(periods[0].start); setShowForm(true) }}>
          + Nova marcação
        </button>
      </div>
      {ready && !ownAgenda && <label className="account-form" htmlFor="agenda-staff-filter">Agenda do colaborador<select id="agenda-staff-filter" value={staffFilter} disabled={busy} onChange={e=>{setStaffFilter(e.target.value);setShowForm(false)}}><option value="">Todas as agendas</option>{data.staff.map(m=><option key={m.id} value={m.id}>{m.name}{m.is_active?'':' (inativo)'}</option>)}</select></label>}
      {ready && <p>{periods.length ? `Horários deste dia: ${periods.map((period) => `${period.start}–${period.end}`).join(' · ')}.` : 'O negócio está encerrado neste dia.'} As horas correspondem ao horário local do negócio.</p>}
      <div className="date-navigation">
        <button type="button" aria-label="Dia anterior" disabled={busy} onClick={() => changeDay(-1)}>‹</button>
        <input type="date" aria-label="Selecionar data" value={selectedDate} disabled={busy}
          onChange={(event) => selectDate(event.target.value)} />
        <button type="button" aria-label="Dia seguinte" disabled={busy} onClick={() => changeDay(1)}>›</button>
      </div>
      {loading && <p role="status">A carregar agenda...</p>}
      {loadError && <div role="alert"><p>{loadError}</p><button type="button" className="secondary-button" onClick={() => setReload((value) => value + 1)}>Tentar novamente</button></div>}
      {ready && services.length === 0 && <p>Cria ou reativa um serviço na página Serviços para adicionar marcações.</p>}
      {showForm && (
        <form className="booking-form" onSubmit={submit}>
          <h2>Nova marcação</h2><label htmlFor="booking-staff">Colaborador</label><select id="booking-staff" required disabled={busy} value={bookingStaff} onChange={e=>setBookingStaff(e.target.value)}><option value="">Seleciona um colaborador</option>{data?.staff.filter(m=>m.is_active).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <label htmlFor="booking-customer">Nome do cliente</label>
          <input id="booking-customer" value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={100} required disabled={busy} />
          <label htmlFor="booking-service">Serviço</label>
          <select id="booking-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required disabled={busy || !ready}>
            <option value="">Seleciona um serviço</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.duration_minutes} min</option>)}
          </select>
          <label htmlFor="booking-time">Hora de início</label>
          <input id="booking-time" type="time" min={periods[0]?.start} max={periods.at(-1)?.end} step="60" value={startTime} onChange={(e) => setStartTime(e.target.value)} required disabled={busy} />
          {selectedService && <p>Termina às <strong>{endTime}</strong></p>}
          {quote && <div className="payment-example"><strong>Regra de pagamento atual</strong>
            <p>Total: {euro.format(quote.total_cents / 100)} · Online: {euro.format(quote.online_due_cents / 100)} · No local: {euro.format(quote.on_site_due_cents / 100)}</p>
            <p>Esta marcação interna não efetua nem confirma qualquer pagamento.</p></div>}
          <div className="booking-form-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setShowForm(false); setError('') }}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={!canManage || busy || !ready || !selectedService || periods.length === 0}>{busy ? 'A guardar...' : 'Guardar'}</button>
          </div>
        </form>
      )}
      {error && <p className="booking-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {ready && <div className="daily-bookings">
        <h2>Marcações do dia ({bookings.length})</h2>
        {bookings.length === 0 && <div className="empty-agenda"><p>Não existem marcações neste dia.</p></div>}
        {bookings.map((booking) => <article className="agenda-card" key={booking.id}>
          <div className="agenda-time"><strong>{booking.start_at.slice(11, 16)}</strong><span>{booking.end_at.slice(11, 16)}</span></div>
          <div className="agenda-details"><strong>{booking.customer_name}</strong><span>{booking.service_name} · {booking.staff_name}</span>
            <span className={`booking-status booking-status-${booking.status}`}>{({ confirmed: 'Confirmada', completed: 'Concluída', canceled: 'Cancelada', no_show: 'Não compareceu' })[booking.status]}</span>
            {booking.customer_email && <a href={`mailto:${booking.customer_email}`}>{booking.customer_email}</a>}
            {booking.customer_phone && <a href={`tel:${booking.customer_phone.replace(/[^+\d]/g, '')}`}>{booking.customer_phone}</a>}
            {booking.booking_source === 'public' && <span>Reserva online · {booking.on_site_due_cents === 0 ? 'Gratuito' : `${euro.format((booking.on_site_due_cents || 0) / 100)} a pagar no local`}</span>}
          </div>
          {booking.status === 'confirmed' && <div className="booking-status-actions" aria-label={`Estado da marcação de ${booking.customer_name}`}>
            {canManage && <><button type="button" className="secondary-button" disabled={busy || showForm || booking.end_at > now} title={booking.end_at > now ? 'Disponível depois do fim da marcação' : undefined} onClick={() => void changeStatus(booking, 'completed')}>Concluir</button>
              <button type="button" className="secondary-button" disabled={busy || showForm || booking.end_at > now} title={booking.end_at > now ? 'Disponível depois do fim da marcação' : undefined} onClick={() => void changeStatus(booking, 'no_show')}>Não compareceu</button></>}
            <button type="button" className="agenda-delete" disabled={busy || showForm} onClick={() => void changeStatus(booking, 'canceled')}>Cancelar marcação</button>
          </div>}
        </article>)}
      </div>}
    </section>
  )
}
