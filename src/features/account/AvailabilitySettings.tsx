import { useEffect, useState, type FormEvent } from 'react'
import { secureFetch } from './accountApi'
import { getAvailability, type Availability } from './availabilityApi'
type Conflict = { id: string; customer_name: string; start_at: string; end_at: string; total: number }
const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
const order = [1, 2, 3, 4, 5, 6, 0]

export default function AvailabilitySettings({ canManage }: { canManage: boolean }) {
  const [value, setValue] = useState<Availability | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getAvailability()
        if (!cancelled) { setValue(data); setError('') }
      } catch { if (!cancelled) setError('Não foi possível carregar os horários.') }
    }
    void load()
    return () => { cancelled = true }
  }, [retry])

  function changeDay(day: number, slots: Availability['weekly'][number]) {
    setValue((current) => current && { ...current, weekly: current.weekly.map((old, index) => index === day ? slots : old) })
    setNotice(''); setConflicts([]); setError('')
  }
  function changeClosure(index: number, field: 'start_date' | 'end_date' | 'reason', text: string) {
    setValue((current) => current && { ...current, closures: current.closures.map((closure, i) => i === index ? { ...closure, [field]: text } : closure) })
    setNotice(''); setConflicts([]); setError('')
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManage || saving || !value) return
    setSaving(true); setError(''); setNotice(''); setConflicts([])
    try {
      const response = await secureFetch('/api/availability', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
      const data = await response.json()
      if (!response.ok) {
        setConflicts(data.conflicts || [])
        throw new Error(data.error || 'Não foi possível guardar os horários.')
      }
      setValue(data)
      setNotice('Horários guardados com sucesso.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível guardar os horários.') }
    finally { setSaving(false) }
  }

  return <details className="panel availability-settings">
    <summary>Horários, pausas e encerramentos</summary>
    <p>As horas correspondem ao horário local do negócio (Europe/Lisbon). Para uma pausa, cria dois períodos separados.
      Os períodos devem começar e terminar no mesmo dia.</p>
    {!value && !error && <p role="status">A carregar horários...</p>}
    {!value && error && <button type="button" className="secondary-button" onClick={() => setRetry((n) => n + 1)}>Tentar novamente</button>}
    {value && <form className="account-form" onSubmit={save}>
      <fieldset disabled={saving || !canManage}>
        <legend>Horário semanal</legend>
        {order.map((day) => <div className="availability-day" key={day}>
          <label className="availability-check"><input type="checkbox" checked={value.weekly[day].length > 0}
            onChange={(e) => changeDay(day, e.target.checked ? [{ start: '09:00', end: '18:00' }] : [])} />{days[day]}</label>
          {value.weekly[day].length === 0 && <span>Encerrado</span>}
          <div className="availability-periods">
            {value.weekly[day].map((slot, index) => <div className="availability-period" key={index}>
              <label>Das<input type="time" step="60" aria-label={`Início ${days[day]}, período ${index + 1}`} value={slot.start} required
                onChange={(e) => changeDay(day, value.weekly[day].map((old, i) => i === index ? { ...old, start: e.target.value } : old))} /></label>
              <label>Até<input type="time" step="60" aria-label={`Fim ${days[day]}, período ${index + 1}`} value={slot.end} required
                onChange={(e) => changeDay(day, value.weekly[day].map((old, i) => i === index ? { ...old, end: e.target.value } : old))} /></label>
              <button type="button" className="secondary-button" aria-label={`Remover período ${index + 1} de ${days[day]}`}
                onClick={() => changeDay(day, value.weekly[day].filter((_, i) => i !== index))}>Remover</button>
            </div>)}
            {value.weekly[day].length > 0 && <button type="button" className="secondary-button" disabled={value.weekly[day].length >= 8}
              onClick={() => changeDay(day, [...value.weekly[day], { start: '', end: '' }])}>+ Período em {days[day]}</button>}
          </div>
        </div>)}
        <h3>Férias e dias encerrados</h3>
        <p>As datas de início e fim estão incluídas. Para fechar um único dia, usa a mesma data nos dois campos.</p>
        {value.closures.length === 0 && <p>Sem encerramentos adicionais.</p>}
        {value.closures.map((closure, index) => <div className="availability-closure" key={index}>
          <label>De<input type="date" aria-label={`Início do encerramento ${index + 1}`} value={closure.start_date} required onChange={(e) => changeClosure(index, 'start_date', e.target.value)} /></label>
          <label>Até<input type="date" aria-label={`Fim do encerramento ${index + 1}`} value={closure.end_date} min={closure.start_date || undefined} required onChange={(e) => changeClosure(index, 'end_date', e.target.value)} /></label>
          <label>Motivo (opcional)<input value={closure.reason} aria-label={`Motivo do encerramento ${index + 1}`} maxLength={100} onChange={(e) => changeClosure(index, 'reason', e.target.value)} /></label>
          <button type="button" className="secondary-button" aria-label={`Remover encerramento ${index + 1}`}
            onClick={() => { setValue({ ...value, closures: value.closures.filter((_, i) => i !== index) }); setNotice(''); setError(''); setConflicts([]) }}>Remover</button>
        </div>)}
        <button type="button" className="secondary-button" disabled={value.closures.length >= 100}
          onClick={() => { setValue({ ...value, closures: [...value.closures, { start_date: '', end_date: '', reason: '' }] }); setNotice('') }}>+ Adicionar encerramento</button>
        <button type="submit" className="primary-button">{saving ? 'A guardar...' : 'Guardar horários'}</button>
      </fieldset>
    </form>}
    {!canManage && <p>Podes consultar os horários. Para alterar, precisas de um teste ou subscrição ativa.</p>}
    {error && <p className="booking-error" role="alert">{error}</p>}
    {conflicts.length > 0 && <div><p>{conflicts[0].total} marcações em conflito{conflicts[0].total > 50 ? ' (primeiras 50)' : ''}:</p>
      <ul>{conflicts.map((booking) => <li key={booking.id}>{booking.customer_name} · {booking.start_at.slice(0, 10)} · {booking.start_at.slice(11, 16)}–{booking.end_at.slice(11, 16)}</li>)}</ul></div>}
    {notice && <p role="status">{notice}</p>}
  </details>
}
