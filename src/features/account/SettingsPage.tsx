import { useState, type FormEvent } from 'react'
import { accountRequest, type Account } from './accountApi'

export default function SettingsPage({ account, onChange }: { account: Account; onChange: (account: Account) => void }) {
  const [profile, setProfile] = useState({ ...account.organization, full_name: account.user.full_name })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMessage(''); setError('')
    try {
      const updated = await accountRequest<Account>('profile', 'PATCH', profile)
      onChange(updated)
      setProfile({ ...updated.organization, full_name: updated.user.full_name })
      setMessage('Perfil guardado com sucesso.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível guardar.') }
    finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setMessage('')
    if (newPassword !== confirmation) { setError('As palavras-passe não coincidem.'); return }
    setBusy(true)
    try {
      await accountRequest('auth/password', 'POST', { current_password: currentPassword, new_password: newPassword })
      setCurrentPassword(''); setNewPassword(''); setConfirmation('')
      setMessage('Palavra-passe alterada. As outras sessões foram terminadas.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a palavra-passe.') }
    finally { setBusy(false) }
  }

  function field(key: keyof typeof profile, value: string) { setProfile((current) => ({ ...current, [key]: value })) }

  return <div className="settings-page">
    <div className="settings-grid">
      <form className="account-form panel" onSubmit={save}>
        <h2>Conta e negócio</h2>
        <fieldset disabled={busy}>
          <label htmlFor="profile-full-name">O teu nome</label>
          <input id="profile-full-name" autoComplete="name" value={profile.full_name} onChange={(e) => field('full_name', e.target.value)} maxLength={100} required />
          <label htmlFor="profile-login-email">Email de acesso</label>
          <input id="profile-login-email" type="email" value={account.user.email} readOnly />
          <label htmlFor="profile-name">Nome do negócio</label>
          <input id="profile-name" value={profile.name} onChange={(e) => field('name', e.target.value)} maxLength={100} required />
          <label htmlFor="profile-slug">Link do negócio</label>
          <input id="profile-slug" value={profile.slug} onChange={(e) => field('slug', e.target.value)}
            minLength={3} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoCapitalize="none" spellCheck={false} required />
          <small>/{profile.slug} · A página pública será disponibilizada numa próxima etapa.</small>
          <label htmlFor="profile-description">Descrição</label>
          <textarea id="profile-description" value={profile.description} onChange={(e) => field('description', e.target.value)} maxLength={1000} rows={4} />
          <label htmlFor="profile-contact-email">Email de contacto do negócio</label>
          <input id="profile-contact-email" type="email" value={profile.contact_email} onChange={(e) => field('contact_email', e.target.value)} maxLength={254} />
          <label htmlFor="profile-phone">Telefone</label>
          <input id="profile-phone" type="tel" value={profile.phone} onChange={(e) => field('phone', e.target.value)} maxLength={40} />
          <label htmlFor="profile-color">Cor principal</label>
          <input id="profile-color" type="color" value={profile.brand_color} onChange={(e) => field('brand_color', e.target.value)} />
          <label htmlFor="profile-logo">Endereço do logótipo (HTTPS)</label>
          <input id="profile-logo" type="url" placeholder="https://exemplo.pt/logotipo.png" value={profile.logo_url}
            onChange={(e) => field('logo_url', e.target.value)} maxLength={2048} />
          <button type="submit" className="primary-button">{busy ? 'A processar...' : 'Guardar perfil'}</button>
        </fieldset>
      </form>
      <aside className="profile-preview panel" aria-label="Pré-visualização do negócio" style={{ borderTop: `6px solid ${profile.brand_color}` }}>
        <span className="eyebrow">Pré-visualização</span>
        {profile.logo_url.startsWith('https://') && <img key={profile.logo_url} src={profile.logo_url} alt="Logótipo do negócio" referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.hidden = true }} />}
        <h2>{profile.name || 'O teu negócio'}</h2>
        <p>{profile.description || 'A descrição do teu negócio aparece aqui.'}</p>
        <p>{profile.contact_email}</p><p>{profile.phone}</p>
        <code>/{profile.slug}</code>
      </aside>
    </div>
    {error && <p className="booking-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <form className="account-form panel password-form" onSubmit={changePassword}>
      <h2>Alterar palavra-passe</h2>
      <fieldset disabled={busy}>
        <label htmlFor="password-current">Palavra-passe atual</label>
        <input id="password-current" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} minLength={12} maxLength={128} required />
        <label htmlFor="password-new">Nova palavra-passe</label>
        <input id="password-new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={12} maxLength={128} required />
        <label htmlFor="password-confirm">Confirmar nova palavra-passe</label>
        <input id="password-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} minLength={12} maxLength={128} required />
        <button type="submit" className="secondary-button">{busy ? 'A processar...' : 'Alterar palavra-passe'}</button>
      </fieldset>
    </form>
  </div>
}
