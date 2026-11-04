
import { useState } from 'react'
import './App.css'
import ServicesPage from './features/services/ServicesPage'
import BookingsPage from './features/bookings/BookingsPage'
import SettingsPage from './features/account/SettingsPage'
import DashboardPage from './features/account/DashboardPage'
import SubscriptionBanner from './features/account/SubscriptionBanner'
import InvoicesPage from './features/account/InvoicesPage'
import StaffPage from './features/account/StaffPage'
import Avatar from './features/account/Avatar'
import type { Account } from './features/account/accountApi'

type Page =
  | 'Dashboard'
  | 'Marcações'
  | 'Serviços'
  | 'Clientes'
  | 'Definições'
  | 'Faturas'
  | 'Colaboradores'

const navigation: { page: Page; label: string; icon: string }[] = [
  { page: 'Dashboard', label: 'Início', icon: '⌂' },
  { page: 'Marcações', label: 'Agenda', icon: '▦' },
  { page: 'Serviços', label: 'Serviços', icon: '◇' },
  { page: 'Clientes', label: 'Clientes', icon: '♙' },
  { page: 'Colaboradores', label: 'Equipa', icon: '♧' },
  { page: 'Faturas', label: 'Faturas', icon: '▤' },
  { page: 'Definições', label: 'Mais', icon: '☰' },
]

function App({ account, onAccountChange, onLogout }: {
  account: Account; onAccountChange: (account: Account) => void; onLogout: () => Promise<void>
}) {
  const isOwner = account.user.role === 'owner'
  const menu = isOwner ? navigation : navigation.filter(n=>['Marcações','Definições'].includes(n.page))
  const [activePage, setActivePage] = useState<Page>(isOwner ? 'Dashboard':'Marcações')
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')
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
          {menu.map(({ page }) => (
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
          <Avatar name={account.user.full_name} src={account.user.photo_url} />
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
            <Avatar name={account.user.full_name} src={account.user.photo_url} />
            <button type="button" className="logout-button" disabled={logoutBusy} onClick={() => void logout()}>{logoutBusy ? 'A sair...' : 'Sair'}</button>
          </div>
        </header>

        {logoutError && <p className="booking-error" role="alert">{logoutError}</p>}
        {isOwner && <SubscriptionBanner subscription={account.subscription} onViewPlan={() => setActivePage('Definições')} />}
        {activePage === 'Dashboard' ? (
          <DashboardPage name={account.user.full_name} />
        ) : activePage === 'Serviços' ? (
          <ServicesPage canManage={account.subscription.can_manage} />
        ) : activePage === 'Marcações' ? (
          <BookingsPage canManage={account.subscription.can_manage} ownAgenda={!isOwner} />
        ) : activePage === 'Definições' ? (
          <SettingsPage account={account} onChange={onAccountChange} />
        ) : activePage === 'Faturas' && isOwner ? (
          <InvoicesPage />
        ) : activePage === 'Colaboradores' && isOwner ? (
          <StaffPage canManage={account.subscription.can_manage} />
        ) : (
          <section className="panel">
            <h2>{activePage}</h2>
            <p>Esta funcionalidade será desenvolvida em breve.</p>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Navegação móvel">
        {menu.map(({ page, label, icon }) => (
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
