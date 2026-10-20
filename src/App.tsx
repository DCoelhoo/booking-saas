
import { useState } from 'react'
import './App.css'

type Page =
  | 'Dashboard'
  | 'Marcações'
  | 'Serviços'
  | 'Clientes'
  | 'Definições'

type Booking = {
  id: number
  customer: string
  service: string
  time: string
}

const navigation: { page: Page; label: string; icon: string }[] = [
  { page: 'Dashboard', label: 'Início', icon: '⌂' },
  { page: 'Marcações', label: 'Agenda', icon: '▦' },
  { page: 'Serviços', label: 'Serviços', icon: '◇' },
  { page: 'Clientes', label: 'Clientes', icon: '♙' },
  { page: 'Definições', label: 'Mais', icon: '☰' },
]

const bookings: Booking[] = [
  { id: 1, customer: 'João Silva', service: 'Serviço A', time: '09:30' },
  { id: 2, customer: 'Maria Costa', service: 'Serviço B', time: '10:00' },
  { id: 3, customer: 'Pedro Santos', service: 'Serviço A', time: '11:30' },
]

const stats = [
  { label: 'Marcações hoje', value: '12' },
  { label: 'Esta semana', value: '48' },
  { label: 'Serviços ativos', value: '5' },
  { label: 'Receita hoje', value: '230 €' },
]

function App() {
  const [activePage, setActivePage] = useState<Page>('Dashboard')

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">B</span>
          <span>Booking SaaS</span>
        </div>

        <nav className="navigation" aria-label="Navegação lateral">
          {navigation.map(({ page }) => (
            <button
              key={page}
              type="button"
              className={`nav-item ${activePage === page ? 'active' : ''}`}
              onClick={() => setActivePage(page)}
              aria-current={activePage === page ? 'page' : undefined}
            >
              {page}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar">DN</div>
          <div>
            <strong>O meu negócio</strong>
            <small>Plano Essencial</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">O meu negócio</span>
            <h1>{activePage}</h1>
          </div>
          <div className="user-avatar" aria-label="Perfil do negócio">DN</div>
        </header>

        {activePage === 'Dashboard' ? (
          <div className="dashboard">
            <section className="welcome">
              <h2>Bem-vindo!</h2>
              <p>Consulta as tuas próximas marcações.</p>
            </section>

            <section className="stats-grid" aria-label="Estatísticas">
              {stats.map((stat) => (
                <article className="stat-card" key={stat.label}>
                  <p>{stat.label}</p>
                  <strong>{stat.value}</strong>
                </article>
              ))}
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>Próximas marcações</h2>
                <p>Resumo da agenda de hoje</p>
              </div>

              <div className="bookings-list">
                {bookings.map((booking) => (
                  <article className="booking-card" key={booking.id}>
                    <span className="booking-time">{booking.time}</span>
                    <div className="booking-details">
                      <strong>{booking.customer}</strong>
                      <span>{booking.service}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <section className="panel">
            <h2>{activePage}</h2>
            <p>Esta funcionalidade será desenvolvida em breve.</p>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Navegação móvel">
        {navigation.map(({ page, label, icon }) => (
          <button
            key={page}
            type="button"
            className={`bottom-nav-item ${activePage === page ? 'active' : ''}`}
            onClick={() => setActivePage(page)}
            aria-current={activePage === page ? 'page' : undefined}
          >
            <span className="bottom-nav-icon" aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
