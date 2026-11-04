import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AccountRoot from './features/account/AccountRoot.tsx'
import PublicBookingPage from './features/public/PublicBookingPage'
import ManageBookingPage from './features/public/ManageBookingPage'
import LandingPage from './features/landing/LandingPage'

// Preserve existing email links while keeping the homepage separate from the account area.
const emailHash = new URLSearchParams(window.location.hash.slice(1))
if (window.location.pathname === '/' && ['change-password','reset-password','staff-invitation'].some(key=>emailHash.has(key))) {
  window.history.replaceState(null,'',`/conta${window.location.hash}`)
}

const publicSlug = window.location.pathname.replace(/^\/|\/$/g, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicSlug === 'conta' ? <AccountRoot /> : publicSlug === 'reserva/gerir' ? <ManageBookingPage /> : publicSlug ? <PublicBookingPage slug={publicSlug} preview={new URLSearchParams(window.location.search).get('preview')==='1'} /> : <LandingPage />}
  </StrictMode>,
)
