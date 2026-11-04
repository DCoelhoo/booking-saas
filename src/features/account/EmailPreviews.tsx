import { useEffect, useState } from 'react'
import { secureFetch } from './accountApi'

type Message = { id: string; kind: string; to: string; subject: string; text: string }

export default function EmailPreviews() {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  useEffect(() => {
    if (!local) return
    let cancelled = false
    async function load() {
      try {
        const response = await secureFetch('/api/email-previews')
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled) setMessages(data.messages)
      } catch { /* The preview is an optional local development tool. */ }
    }
    void load()
    window.addEventListener('email-preview-updated', load)
    return () => { cancelled = true; window.removeEventListener('email-preview-updated', load) }
  }, [local])
  if (!local || !messages) return null
  return <details className="panel email-previews">
    <summary>Emails locais: não enviados</summary>
    <p>Pré-visualização para testes. Estas mensagens não são enviadas para caixas de correio reais.</p>
    <p>Os lembretes são preparados cerca de 24 horas antes. Reservas criadas ou reagendadas com menos antecedência recebem apenas a confirmação da alteração.</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => {
      setBusy(true); setError(''); setNotice('')
      void (async () => {
        const response = await fetch('/api/reminders/preview-run', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const result = await response.json()
        if (!response.ok) throw Error(result.error || 'Não foi possível processar os lembretes.')
        const previews = await secureFetch('/api/email-previews')
        if (!previews.ok) throw Error('Os lembretes foram processados, mas não foi possível atualizar os emails. Volta a abrir as Definições.')
        setMessages((await previews.json()).messages)
        setNotice(result.message)
      })().catch((cause: Error) => setError(cause.message)).finally(() => setBusy(false))
    }}>{busy ? 'A processar...' : 'Processar lembretes locais'}</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {messages.length === 0 && <p>Ainda não existem mensagens.</p>}
    {messages.map((message) => <article key={message.id}>
      <h3>{message.subject}</h3><p>Para: {message.to}</p>
      <pre>{message.text}</pre>
      {message.kind === 'staff_invitation' && message.text.match(/https?:\/\/\S+/)?.[0] && <a href={message.text.match(/https?:\/\/\S+/)![0]} referrerPolicy="no-referrer">Abrir convite de colaborador</a>}
      {['password_request', 'password_reset_request'].includes(message.kind) && message.text.match(/https?:\/\/\S+/)?.[0] &&
        <a href={message.text.match(/https?:\/\/\S+/)![0]} referrerPolicy="no-referrer">{message.kind === 'password_reset_request' ? 'Abrir recuperação de acesso' : 'Abrir confirmação da palavra-passe'}</a>}
      {message.kind === 'booking_confirmation' && message.text.match(/https?:\/\/\S+/)?.[0] &&
        <a href={message.text.match(/https?:\/\/\S+/)![0]} referrerPolicy="no-referrer">Gerir marcação de teste</a>}
    </article>)}
  </details>
}
