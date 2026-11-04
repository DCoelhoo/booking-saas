import { useEffect, useState, type FormEvent } from 'react'
import { getServices, type Service } from '../services/servicesApi'
import { getBookings, createBooking, deleteBooking, type Booking } from './bookingsApi'
import './BookingsPage.css'

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function BookingsPage() {
  const [selectedDate, setSelectedDate] = useState(() => localDate(new Date()))
  const [data, setData] = useState<{ date: string; bookings: Booking[]; services: Service[] } | null>(null)
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
        const [bookings, services] = await Promise.all([getBookings(selectedDate), getServices()])
        if (!cancelled) setData({ date: selectedDate, bookings, services: services.filter((s) => s.is_active === 1) })
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
  const bookings = ready ? data.bookings : []
  const selectedService = services.find((s) => s.id === serviceId)
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
    if (busy || !ready) return
    setError('')
    setNotice('')
    if (!selectedService || !customer.trim()) {
      setError('Indica o nome do cliente e um serviço ativo.')
      return
    }
    setBusy(true)
    try {
      const booking = await createBooking({ customer_name: customer.trim(), service_id: serviceId, date: selectedDate, start_time: startTime })
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

  async function remove(booking: Booking) {
    if (busy || !window.confirm(`Eliminar a marcação de ${booking.customer_name}?`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await deleteBooking(booking.id)
      setData((current) => current && ({ ...current, bookings: current.bookings.filter((b) => b.id !== booking.id) }))
      setNotice('Marcação eliminada com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível eliminar a marcação.')
      setReload((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bookings-page">
      <div className="bookings-heading">
        <div><h2>Agenda</h2><p>Gere as marcações do teu negócio.</p></div>
        <button type="button" className="primary-button" disabled={!ready || busy || showForm || services.length === 0}
          onClick={() => { setError(''); setNotice(''); setServiceId(services[0].id); setShowForm(true) }}>
          + Nova marcação
        </button>
      </div>
      <p>Horário atual: 09:00–18:00. As horas correspondem ao horário local do negócio.</p>
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
          <h2>Nova marcação</h2>
          <label htmlFor="booking-customer">Nome do cliente</label>
          <input id="booking-customer" value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={100} required disabled={busy} />
          <label htmlFor="booking-service">Serviço</label>
          <select id="booking-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required disabled={busy || !ready}>
            <option value="">Seleciona um serviço</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.duration_minutes} min</option>)}
          </select>
          <label htmlFor="booking-time">Hora de início</label>
          <input id="booking-time" type="time" min="09:00" max="18:00" step="60" value={startTime} onChange={(e) => setStartTime(e.target.value)} required disabled={busy} />
          {selectedService && <p>Termina às <strong>{endTime}</strong></p>}
          <div className="booking-form-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setShowForm(false); setError('') }}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={busy || !ready || !selectedService}>{busy ? 'A guardar...' : 'Guardar'}</button>
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
          <div className="agenda-details"><strong>{booking.customer_name}</strong><span>{booking.service_name}</span></div>
          <button type="button" className="agenda-delete" disabled={busy || showForm} onClick={() => void remove(booking)} aria-label={`Eliminar marcação de ${booking.customer_name}`}>Eliminar</button>
        </article>)}
      </div>}
    </section>
  )
}
