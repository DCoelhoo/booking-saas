import { useEffect, useState } from 'react'
import { getServices } from '../services/servicesApi'
import { getBookings, type Booking } from '../bookings/bookingsApi'

export default function DashboardPage({ name }: { name: string }) {
  const [data, setData] = useState<{ bookings: Booking[]; services: number } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon' }).format(new Date())
    Promise.all([getBookings(date), getServices()]).then(([bookings, services]) => {
      if (!cancelled) setData({ bookings, services: services.filter((s) => s.is_active === 1).length })
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])
  return <div className="dashboard">
    <section className="welcome"><h2>Bem-vindo, {name}!</h2><p>Consulta a agenda do teu negócio.</p></section>
    {error ? <p role="alert">Não foi possível carregar o resumo. Consulta a Agenda ou os Serviços.</p>
      : !data ? <p role="status">A carregar resumo...</p> : <>
        <section className="stats-grid" aria-label="Estatísticas">
          <article className="stat-card"><p>Marcações hoje</p><strong>{data.bookings.length}</strong></article>
          <article className="stat-card"><p>Serviços ativos</p><strong>{data.services}</strong></article>
        </section>
        <section className="panel"><h2>Marcações de hoje</h2>
          {data.bookings.length === 0 ? <p>Ainda não existem marcações para hoje.</p> :
            <div className="bookings-list">{data.bookings.map((booking) => <article className="booking-card" key={booking.id}>
              <span className="booking-time">{booking.start_at.slice(11, 16)}</span>
              <div className="booking-details"><strong>{booking.customer_name}</strong><span>{booking.service_name}</span></div>
            </article>)}</div>}
        </section>
      </>}
  </div>
}
