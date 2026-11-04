import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AccountRoot from './features/account/AccountRoot.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountRoot />
  </StrictMode>,
)
