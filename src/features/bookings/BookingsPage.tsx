
import { useState, type FormEvent } from 'react'
import './BookingsPage.css'

type Service = {
  id: string
  name: string
  duration: number
}

type Booking = {
  id: string
  customer: string
  serviceId: string
  date: string
  startTime: string
}

// Dados temporários para testar a agenda
const services: Service[] = [
  { id: '1', name: 'Serviço A', duration: 30 },
  { id: '2', name: 'Serviço B', duration: 60 },
]

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export default function BookingsPage() {
  const [selectedDate, setSelectedDate] = useState(
    () => localDate(new Date())
  )

  const [bookings, setBookings] = useState<Booking[]>([])
  const [showForm, setShowForm] = useState(false)

  const [customer, setCustomer] = useState('')
  const [serviceId, setServiceId] = useState(services[0].id)
  const [startTime, setStartTime] = useState('09:00')
  const [error, setError] = useState('')

  const selectedService = services.find(
    (service) => service.id === serviceId
  )

  const dailyBookings = bookings
    .filter((booking) => booking.date === selectedDate)
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))

  function changeDay(offset: number) {
    const date = new Date(`${selectedDate}T12:00:00`)
    date.setDate(date.getDate() + offset)
    setSelectedDate(localDate(date))
  }

  function createBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!selectedService || !customer.trim()) return

    const start = toMinutes(startTime)
    const end = start + selectedService.duration

    // Horário de funcionamento temporário: 09h-18h
    if (start < 540 || end > 1080) {
      setError('A marcação deve estar entre as 09:00 e as 18:00.')
      return
    }

    const hasConflict = dailyBookings.some((booking) => {
      const service = services.find(
        (item) => item.id === booking.serviceId
      )

      if (!service) return false

      const existingStart = toMinutes(booking.startTime)
      const existingEnd = existingStart + service.duration

      return start < existingEnd && end > existingStart
    })

    if (hasConflict) {
      setError('Este horário já está ocupado por outra marcação.')
      return
    }

    const newBooking: Booking = {
      id: crypto.randomUUID(),
      customer: customer.trim(),
      serviceId,
      date: selectedDate,
      startTime,
    }

    setBookings((current) => [...current, newBooking])

    setCustomer('')
    setStartTime('09:00')
    setShowForm(false)
  }

  function deleteBooking(id: string) {
    if (!window.confirm('Eliminar esta marcação?')) return

    setBookings((current) =>
      current.filter((booking) => booking.id !== id)
    )
  }

  return (
    <section className="bookings-page">
      <div className="bookings-heading">
        <div>
          <h2>Agenda</h2>
          <p>Gere as marcações do teu negócio.</p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setError('')
            setShowForm(true)
          }}
        >
          + Nova marcação
        </button>
      </div>

      <div className="date-navigation">
        <button
          type="button"
          aria-label="Dia anterior"
          onClick={() => changeDay(-1)}
        >
          ‹
        </button>

        <input
          type="date"
          aria-label="Selecionar data"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
        />

        <button
          type="button"
          aria-label="Dia seguinte"
          onClick={() => changeDay(1)}
        >
          ›
        </button>
      </div>

      {showForm && (
        <form className="booking-form" onSubmit={createBooking}>
          <h2>Nova marcação</h2>

          <label htmlFor="booking-customer">Nome do cliente</label>
          <input
            id="booking-customer"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
            placeholder="Nome do cliente"
            maxLength={100}
            required
          />

          <label htmlFor="booking-service">Serviço</label>
          <select
            id="booking-service"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} — {service.duration} min
              </option>
            ))}
          </select>

          <label htmlFor="booking-time">Hora de início</label>
          <input
            id="booking-time"
            type="time"
            min="09:00"
            max="18:00"
            step="900"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            required
          />

          {selectedService && (
            <p>
              Termina às{' '}
              <strong>
                {formatTime(
                  toMinutes(startTime) + selectedService.duration
                )}
              </strong>
            </p>
          )}

          {error && <p className="booking-error" role="alert">{error}</p>}

          <div className="booking-form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowForm(false)}
            >
              Cancelar
            </button>

            <button type="submit" className="primary-button">
              Guardar
            </button>
          </div>
        </form>
      )}

      <div className="daily-bookings">
        <h2>Marcações do dia ({dailyBookings.length})</h2>

        {dailyBookings.length === 0 && (
          <div className="empty-agenda">
            <p>Não existem marcações neste dia.</p>
          </div>
        )}

        {dailyBookings.map((booking) => {
          const service = services.find(
            (item) => item.id === booking.serviceId
          )

          return (
            <article className="agenda-card" key={booking.id}>
              <div className="agenda-time">
                <strong>{booking.startTime}</strong>
                <span>
                  {service
                    ? formatTime(
                        toMinutes(booking.startTime) + service.duration
                      )
                    : '--:--'}
                </span>
              </div>

              <div className="agenda-details">
                <strong>{booking.customer}</strong>
                <span>{service?.name ?? 'Serviço desconhecido'}</span>
              </div>

              <button
                type="button"
                className="agenda-delete"
                onClick={() => deleteBooking(booking.id)}
                aria-label={`Eliminar marcação de ${booking.customer}`}
              >
                Eliminar
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
