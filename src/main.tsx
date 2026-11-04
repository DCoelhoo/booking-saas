import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AccountRoot from './features/account/AccountRoot.tsx'
import PublicBookingPage from './features/public/PublicBookingPage'
import ManageBookingPage from './features/public/ManageBookingPage'

const publicSlug = window.location.pathname.replace(/^\/|\/$/g, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicSlug === 'reserva/gerir' ? <ManageBookingPage /> : publicSlug ? <PublicBookingPage slug={publicSlug} /> : <AccountRoot />}
  </StrictMode>,
)
