import { useEffect, useState, type FormEvent } from 'react'
import App from '../../App'
import { accountRequest, currentAccount, type Account } from './accountApi'
import './Account.css'
import ConfirmPassword from './ConfirmPassword'
import ForgotPassword from './ForgotPassword'

const passwordLinkToken = () => {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  return hash.get('change-password') || hash.get('reset-password') || hash.get('staff-invitation') || ''
}

export default function AccountRoot() {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [retry, setRetry] = useState(0)
  const [register, setRegister] = useState(()=>new URLSearchParams(window.location.search).get('criar') === '1')
  const [forgot, setForgot] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [passwordToken, setPasswordToken] = useState(passwordLinkToken)
  const [invitation, setInvitation] = useState(()=>new URLSearchParams(window.location.hash.slice(1)).has('staff-invitation'))
  useEffect(()=>{ document.title = 'A minha conta · Booking SaaS' },[])

  useEffect(() => {
    let cancelled = false
    currentAccount().then((value) => { if (!cancelled) setAccount(value) })
      .catch(() => { if (!cancelled) setSessionError('Não foi possível ligar à aplicação. Tenta novamente.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [retry])

  useEffect(() => {
    const expire = () => { setAccount(null); setError('A sessão terminou. Inicia sessão novamente.'); setPassword(''); setConfirmation('') }
    const followEmail = () => { setPasswordToken(passwordLinkToken()); setInvitation(new URLSearchParams(window.location.hash.slice(1)).has('staff-invitation')) }
    window.addEventListener('session-expired', expire)
    window.addEventListener('hashchange', followEmail)
    return () => { window.removeEventListener('session-expired', expire); window.removeEventListener('hashchange', followEmail) }
  }, [])

  const userId = account?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function refresh() {
      try {
        const next = await currentAccount()
        if (!cancelled) setAccount(next)
      } catch { /* Keep the session visible during temporary network failures. The API still checks access. */ }
    }
    const timer = window.setInterval(() => void refresh(), 60_000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    window.addEventListener('subscription-expired', focus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', focus)
      window.removeEventListener('subscription-expired', focus)
    }
  }, [userId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (register && password !== confirmation) { setError('As palavras-passe não coincidem.'); return }
    setBusy(true)
    try {
      const result = await accountRequest<Account>(register ? 'auth/register' : 'auth/login', 'POST', {
        email, password, ...(register ? { full_name: fullName, business_name: businessName, slug } : {}),
      })
      setPassword('')
      setConfirmation('')
      setAccount(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }

  async function logout() {
    await accountRequest('auth/logout', 'POST', {})
    setAccount(null)
    setPassword('')
    setConfirmation('')
    setError('')
    setRegister(false)
  }

  if (passwordToken) return <ConfirmPassword token={passwordToken} invitation={invitation} onDone={() => {
    setPasswordToken(''); setForgot(false); setAccount(null); setPassword(''); setConfirmation(''); setLoading(true); setRetry((n) => n + 1)
  }} />
  if (loading) return <main className="account-shell"><p role="status">A verificar sessão...</p></main>
  if (sessionError) return <main className="account-shell"><p role="alert">{sessionError}</p>
    <button type="button" className="primary-button" onClick={() => { setLoading(true); setSessionError(''); setRetry((value) => value + 1) }}>Tentar novamente</button></main>
  if (account) return <App key={account.user.id} account={account} onAccountChange={setAccount} onLogout={logout} />
  if (forgot) return <ForgotPassword initialEmail={email} onBack={() => setForgot(false)} />

  return <main className="account-shell">
    <section className="account-card">
      <a className="account-brand" href="/">Booking SaaS</a>
      <h1>{register ? 'Cria a tua conta' : 'Bem-vindo de volta'}</h1>
      <p>{register ? 'Experimenta durante 14 dias, sem cartão e sem cobranças automáticas. Depois, o plano é de 10 €/mês por negócio.' : 'Inicia sessão para gerir o teu negócio.'}</p>
      <form className="account-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          {register && <>
            <label htmlFor="account-full-name">O teu nome</label>
            <input id="account-full-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} required />
            <label htmlFor="account-business-name">Nome do negócio</label>
            <input id="account-business-name" autoComplete="organization" value={businessName} maxLength={100} required
              onChange={(e) => {
                setBusinessName(e.target.value)
                if (!slugEdited) setSlug(e.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63))
              }} />
            <label htmlFor="account-slug">Link do negócio</label>
            <input id="account-slug" value={slug} onChange={(e) => { setSlugEdited(true); setSlug(e.target.value) }}
              minLength={3} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoCapitalize="none" spellCheck={false} required aria-describedby="slug-help" />
            <small id="slug-help">/{slug || 'o-teu-negocio'} · O endereço da tua página pública de marcações.</small>
          </>}
          <label htmlFor="account-email">Email</label>
          <input id="account-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required />
          <label htmlFor="account-password">Palavra-passe</label>
          <input id="account-password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={128} required aria-describedby={register ? 'password-help' : undefined} />
          {register && <>
            <small id="password-help">Usa entre 12 e 128 caracteres. Podes usar uma frase com espaços.</small>
            <label htmlFor="account-confirmation">Confirmar palavra-passe</label>
            <input id="account-confirmation" type="password" autoComplete="new-password" value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)} minLength={12} maxLength={128} required />
          </>}
          {error && <p className="booking-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button">{busy ? 'A processar...' : register ? 'Criar conta e negócio' : 'Iniciar sessão'}</button>
        </fieldset>
      </form>
      {!register && <button type="button" className="account-switch" disabled={busy} onClick={() => { setForgot(true); setPassword(''); setError('') }}>Esqueci-me da palavra-passe</button>}
      <button type="button" className="account-switch" disabled={busy} onClick={() => { setRegister(!register); setError(''); setPassword(''); setConfirmation('') }}>
        {register ? 'Já tenho conta: iniciar sessão' : 'Ainda não tenho conta: criar conta'}
      </button>
    </section>
  </main>
}
