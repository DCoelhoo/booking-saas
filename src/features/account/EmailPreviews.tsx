import { useEffect, useState } from 'react'
import { secureFetch } from './accountApi'

type Message = { id: string; kind: string; to: string; subject: string; text: string }

export default function EmailPreviews() {
  const [messages, setMessages] = useState<Message[] | null>(null)
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
    <summary>Emails locais — não enviados</summary>
    <p>Pré-visualização para testes. Estas mensagens não são enviadas para caixas de correio reais.</p>
    {messages.length === 0 && <p>Ainda não existem mensagens.</p>}
    {messages.map((message) => <article key={message.id}>
      <h3>{message.subject}</h3><p>Para: {message.to}</p>
      <pre>{message.text}</pre>
      {message.kind === 'password_request' && message.text.match(/https?:\/\/\S+/)?.[0] &&
        <a href={message.text.match(/https?:\/\/\S+/)![0]} referrerPolicy="no-referrer">Abrir confirmação da palavra-passe</a>}
    </article>)}
  </details>
}
