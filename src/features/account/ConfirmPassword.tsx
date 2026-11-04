import { useEffect, useState, type FormEvent } from 'react'
import { accountRequest } from './accountApi'

export default function ConfirmPassword({ token, onDone, invitation = false }: { token: string; onDone: () => void; invitation?: boolean }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    // Remove the email token from the address bar without sending it in a URL request.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (password !== confirmation) { setError('As palavras-passe não coincidem.'); return }
    setBusy(true)
    try {
      const result = await accountRequest<{ message: string }>(invitation ? 'auth/invitation/accept' : 'auth/password/confirm', 'POST', { token, new_password: password })
      setPassword(''); setConfirmation(''); setMessage(result.message)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a alteração.') }
    finally { setBusy(false) }
  }
  return <main className="account-shell"><section className="account-card">
    <span className="account-brand">Booking SaaS</span><h1>{invitation ? 'Aceitar convite para a equipa' : 'Escolher nova palavra-passe'}</h1>
    {message ? <p role="status">{message}</p> : <>
      <p>{invitation ? 'Escolhe uma palavra-passe para acederes à tua agenda. Depois, inicia sessão com o email que recebeu o convite.' : 'Depois de confirmares, todas as sessões anteriores serão terminadas.'}</p>
      <form className="account-form" onSubmit={submit}><fieldset disabled={busy}>
        <label htmlFor="confirm-new-password">Nova palavra-passe</label>
        <input id="confirm-new-password" type="password" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={128} required />
        <label htmlFor="confirm-repeat-password">Confirmar nova palavra-passe</label>
        <input id="confirm-repeat-password" type="password" autoComplete="new-password" value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)} minLength={12} maxLength={128} required />
        {error && <p className="booking-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button">{busy ? 'A confirmar...' : 'Confirmar nova palavra-passe'}</button>
      </fieldset></form>
    </>}
    <button type="button" className="account-switch" disabled={busy} onClick={onDone}>{message ? 'Voltar ao início de sessão' : 'Voltar à aplicação'}</button>
  </section></main>
}
