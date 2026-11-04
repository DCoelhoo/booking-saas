import { useEffect, useState, type FormEvent } from 'react'
import { accountRequest } from './accountApi'

export default function BookingChangePolicy({ canManage }: { canManage: boolean }) {
  const [hours, setHours] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let canceled = false
    accountRequest<{ hours: number }>('booking-change-policy').then((data) => { if (!canceled) { setHours(data.hours); setError('') } })
      .catch((e: Error) => { if (!canceled) setError(e.message) })
    return () => { canceled = true }
  }, [retry])
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy || hours === null) return
    setBusy(true); setError(''); setNotice('')
    try { await accountRequest('booking-change-policy', 'PUT', { hours }); setNotice('Prazo guardado.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível guardar.') }
    finally { setBusy(false) }
  }
  return <form className="account-form panel" onSubmit={save}>
    <h2>Cancelamento e reagendamento pelos clientes</h2>
    <p>O cliente recebe um link privado no email de confirmação. Define até quantas horas antes da marcação pode cancelar ou reagendar. Depois desse prazo, terá de contactar o negócio.</p>
    <p>Esta regra aplica-se também às marcações existentes. Com 0 horas, permites alterações até à hora de início.</p>
    {hours === null ? <button type="button" className="secondary-button" onClick={() => setRetry((n) => n + 1)}>Carregar prazo</button> : <fieldset disabled={!canManage || busy}>
      <label htmlFor="booking-change-hours">Antecedência mínima (horas)</label>
      <input id="booking-change-hours" type="number" min="0" max="720" step="1" value={hours} onChange={(e) => setHours(e.target.valueAsNumber)} required />
      <button type="submit" className="secondary-button">Guardar prazo</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </form>
}
