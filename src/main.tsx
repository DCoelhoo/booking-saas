import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AccountRoot from './features/account/AccountRoot.tsx'
import PublicBookingPage from './features/public/PublicBookingPage'

const publicSlug = window.location.pathname.replace(/^\/|\/$/g, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicSlug ? <PublicBookingPage slug={publicSlug} /> : <AccountRoot />}
  </StrictMode>,
)
