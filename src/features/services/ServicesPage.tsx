
import { useEffect, useState, type FormEvent } from 'react'
import {
  getServices,
  createService,
  updateService,
  type Service,
} from './servicesApi'
import './ServicesPage.css'

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const [name, setName] = useState('')
  const [duration, setDuration] = useState('30')
  const [price, setPrice] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadServices() {
      try {
        const data = await getServices()

        if (!cancelled) {
          setServices(data)
        }
      } catch {
        if (!cancelled) {
          setError('Não foi possível carregar os serviços.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadServices()

    return () => {
      cancelled = true
    }
  }, [])

  function resetForm() {
    setEditingId(null)
    setName('')
    setDuration('30')
    setPrice('')
    setFormError('')
    setShowForm(false)
  }

  function editService(service: Service) {
    setEditingId(service.id)
    setName(service.name)
    setDuration(String(service.duration_minutes))
    setPrice((service.price_cents / 100).toFixed(2))
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function storeService(service: Service) {
    setServices((current) => [...current.filter((item) => item.id !== service.id), service]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt')))
  }

  async function toggleService(service: Service) {
    if (updatingId || saving) return
    setUpdatingId(service.id)
    setActionError('')
    setNotice('')
    try {
      const updated = await updateService(service.id, { is_active: service.is_active === 1 ? 0 : 1 })
      storeService(updated)
      setNotice(`Serviço ${updated.is_active === 1 ? 'reativado' : 'desativado'} com sucesso.`)
    } catch {
      setActionError('Não foi possível alterar o estado do serviço. Tenta novamente.')
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (saving || updatingId) return

    const durationMinutes = Number(duration)
    const priceValue = Number(price)
    const priceCents = Math.round(priceValue * 100)

    if (
      !name.trim() ||
      name.trim().length > 100 ||
      !Number.isSafeInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      !Number.isFinite(priceValue) ||
      priceValue < 0 ||
      !Number.isSafeInteger(priceCents)
    ) {
      setFormError('Verifica os dados do serviço.')
      return
    }

    setSaving(true)
    setFormError('')

    try {
      const input = {
        name: name.trim(),
        duration_minutes: durationMinutes,
        price_cents: priceCents,
      }
      const savedService = editingId
        ? await updateService(editingId, input)
        : await createService(input)

      storeService(savedService)
      setNotice(editingId ? 'Serviço atualizado com sucesso.' : 'Serviço criado com sucesso.')

      resetForm()
    } catch {
      setFormError('Não foi possível guardar o serviço.')
    } finally {
      setSaving(false)
    }
  }

  const euro = new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
  })

  return (
    <section className="services-page">
      <div className="services-heading">
        <div>
          <h2>Os teus serviços</h2>
          <p>Gere os serviços disponíveis para reserva.</p>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={() => { resetForm(); setNotice(''); setShowForm(true) }}
          disabled={showForm || updatingId !== null || loading || !!error}
        >
          + Novo serviço
        </button>
      </div>

      {showForm && (
        <form className="service-form" onSubmit={handleSubmit}>
          <h2>{editingId ? 'Editar serviço' : 'Novo serviço'}</h2>

          <label htmlFor="service-name">Nome do serviço</label>
          <input
            id="service-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Massagem relaxante"
            maxLength={100}
            required
            disabled={saving}
          />

          <label htmlFor="service-duration">
            Duração (minutos)
          </label>
          <input
            id="service-duration"
            type="number"
            min="1"
            step="1"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            required
            disabled={saving}
          />

          <label htmlFor="service-price">Preço (€)</label>
          <input
            id="service-price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="15.00"
            required
            disabled={saving}
          />

          {formError && (
            <p className="booking-error" role="alert">
              {formError}
            </p>
          )}

          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={resetForm}
              disabled={saving || updatingId !== null}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={saving || updatingId !== null}
            >
              {saving ? 'A guardar...' : 'Guardar serviço'}
            </button>
          </div>
        </form>
      )}

      {notice && <p role="status">{notice}</p>}
      {actionError && <p className="booking-error" role="alert">{actionError}</p>}

      <div className="service-list">
        {loading && <p>A carregar serviços...</p>}

        {!loading && error && (
          <p role="alert">{error}</p>
        )}

        {!loading && !error && services.length === 0 && (
          <p>Ainda não existem serviços.</p>
        )}

        {!loading && !error && services.map((service) => (
          <article className="service-card" key={service.id}>
            <div className="service-info">
              <strong>{service.name}</strong>

              <span className={`service-status ${service.is_active === 1 ? 'is-active' : 'is-inactive'}`}>
                {service.is_active === 1 ? 'Ativo' : 'Inativo'}
              </span>

              <span>{service.duration_minutes} minutos</span>

              <strong className="service-price">
                {euro.format(service.price_cents / 100)}
              </strong>
            </div>
            <div className="service-actions">
              <button type="button" onClick={() => editService(service)}
                disabled={showForm || saving || updatingId !== null}
                aria-label={`Editar ${service.name}`}>
                Editar
              </button>
              <button type="button" onClick={() => void toggleService(service)}
                disabled={showForm || saving || updatingId !== null}
                aria-label={`${service.is_active === 1 ? 'Desativar' : 'Reativar'} ${service.name}`}>
                {updatingId === service.id ? 'A guardar...' : service.is_active === 1 ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
