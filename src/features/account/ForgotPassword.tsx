import { useState, type FormEvent } from 'react'
import { accountRequest } from './accountApi'

export default function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { const result = await accountRequest<{ message: string }>('auth/password/reset', 'POST', { email }); setMessage(result.message) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível pedir a recuperação.') }
    finally { setBusy(false) }
  }
  return <main className="account-shell"><section className="account-card">
    <a className="account-brand" href="/">Giro</a><h1>Recuperar acesso</h1>
    <p>Indica o email da tua conta. Enviaremos um link para escolheres uma nova palavra-passe.</p>
    <form className="account-form" onSubmit={submit}><fieldset disabled={busy}>
      <label htmlFor="reset-email">Email da conta</label><input id="reset-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setMessage('') }} required />
      <button type="submit" className="primary-button">{busy ? 'A processar...' : 'Enviar link de recuperação'}</button>
    </fieldset></form>
    {error && <p className="booking-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button className="account-switch" disabled={busy} onClick={onBack}>Voltar ao início de sessão</button>
  </section></main>
}
