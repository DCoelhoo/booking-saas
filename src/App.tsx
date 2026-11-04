
import { useState } from 'react'
import './App.css'
import ServicesPage from './features/services/ServicesPage'
import BookingsPage from './features/bookings/BookingsPage'
import SettingsPage from './features/account/SettingsPage'
import DashboardPage from './features/account/DashboardPage'
import type { Account } from './features/account/accountApi'

type Page =
  | 'Dashboard'
  | 'Marcações'
  | 'Serviços'
  | 'Clientes'
  | 'Definições'

const navigation: { page: Page; label: string; icon: string }[] = [
  { page: 'Dashboard', label: 'Início', icon: '⌂' },
  { page: 'Marcações', label: 'Agenda', icon: '▦' },
  { page: 'Serviços', label: 'Serviços', icon: '◇' },
  { page: 'Clientes', label: 'Clientes', icon: '♙' },
  { page: 'Definições', label: 'Mais', icon: '☰' },
]

function App({ account, onAccountChange, onLogout }: {
  account: Account; onAccountChange: (account: Account) => void; onLogout: () => Promise<void>
}) {
  const [activePage, setActivePage] = useState<Page>('Dashboard')
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const initials = account.organization.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  async function logout() {
    if (logoutBusy) return
    setLogoutBusy(true); setLogoutError('')
    try { await onLogout() } catch { setLogoutError('Não foi possível terminar a sessão. Tenta novamente.') }
    finally { setLogoutBusy(false) }
  }

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
          <div className="avatar">{initials}</div>
          <div>
            <strong>{account.organization.name}</strong>
            <small>{account.user.email}</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">{account.organization.name}</span>
            <h1>{activePage}</h1>
          </div>
          <div className="topbar-actions">
            <div className="user-avatar" aria-label="Perfil do negócio">{initials}</div>
            <button type="button" className="logout-button" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? 'A sair...' : 'Sair'}</button>
          </div>
        </header>

        {logoutError && <p className="booking-error" role="alert">{logoutError}</p>}
        {activePage === 'Dashboard' ? (
          <DashboardPage name={account.user.full_name} />
        ) : activePage === 'Serviços' ? (
          <ServicesPage />
        ) : activePage === 'Marcações' ? (
          <BookingsPage />
        ) : activePage === 'Definições' ? (
          <SettingsPage account={account} onChange={onAccountChange} />
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
