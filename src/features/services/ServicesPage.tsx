
import { useEffect, useState, type FormEvent } from 'react'
import {
  getServices,
  createService,
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
    setName('')
    setDuration('30')
    setPrice('')
    setFormError('')
    setShowForm(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (saving) return

    const durationMinutes = Number(duration)
    const priceValue = Number(price)
    const priceCents = Math.round(priceValue * 100)

    if (
      !name.trim() ||
      name.trim().length > 100 ||
      !Number.isInteger(durationMinutes) ||
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
      const newService = await createService({
        name: name.trim(),
        duration_minutes: durationMinutes,
        price_cents: priceCents,
      })

      setServices((current) =>
        [...current, newService].sort((a, b) =>
          a.name.localeCompare(b.name, 'pt')
        )
      )

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
          onClick={() => setShowForm(true)}
          disabled={showForm}
        >
          + Novo serviço
        </button>
      </div>

      {showForm && (
        <form className="service-form" onSubmit={handleSubmit}>
          <h2>Novo serviço</h2>

          <label htmlFor="service-name">Nome do serviço</label>
          <input
            id="service-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Massagem relaxante"
            maxLength={100}
            required
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
              disabled={saving}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={saving}
            >
              {saving ? 'A guardar...' : 'Guardar serviço'}
            </button>
          </div>
        </form>
      )}

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

              <span>{service.duration_minutes} minutos</span>

              <strong className="service-price">
                {euro.format(service.price_cents / 100)}
              </strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
