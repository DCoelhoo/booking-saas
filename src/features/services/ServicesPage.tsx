
import { useState, type FormEvent } from 'react'
import './ServicesPage.css'

type Service = {
  id: string
  name: string
  duration: number
  price: number
}

const initialServices: Service[] = [
  {
    id: '1',
    name: 'Serviço A',
    duration: 30,
    price: 15,
  },
  {
    id: '2',
    name: 'Serviço B',
    duration: 60,
    price: 30,
  },
]

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>(initialServices)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [name, setName] = useState('')
  const [duration, setDuration] = useState('30')
  const [price, setPrice] = useState('')

  function resetForm() {
    setName('')
    setDuration('30')
    setPrice('')
    setEditingId(null)
    setShowForm(false)
  }

  function editService(service: Service) {
    setEditingId(service.id)
    setName(service.name)
    setDuration(String(service.duration))
    setPrice(String(service.price))
    setShowForm(true)
  }

  function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedDuration = Number(duration)
    const parsedPrice = Number(price)

    if (
      !name.trim() ||
      !Number.isInteger(parsedDuration) ||
      parsedDuration <= 0 ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0
    ) {
      return
    }

    if (editingId !== null) {
      setServices((current) =>
        current.map((service) =>
          service.id === editingId
            ? { ...service, name: name.trim(), duration: parsedDuration, price: parsedPrice }
            : service
        )
      )
    } else {
      const newService: Service = {
        id: crypto.randomUUID(),
        name: name.trim(),
        duration: parsedDuration,
        price: parsedPrice,
      }

      setServices((current) => [...current, newService])
    }

    resetForm()
  }

  function deleteService(id: string) {
    if (!window.confirm('Queres eliminar este serviço?')) return

    setServices((current) =>
      current.filter((service) => service.id !== id)
    )
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
          <p>Configura os serviços disponíveis para reserva.</p>
        </div>

        <button
          className="primary-button"
          type="button"
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
        >
          + Novo serviço
        </button>
      </div>

      {showForm && (
        <form className="service-form" onSubmit={saveService}>
          <h2>{editingId !== null ? 'Editar serviço' : 'Novo serviço'}</h2>

          <label htmlFor="service-name">Nome</label>
          <input
            id="service-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Corte de cabelo"
            required
            maxLength={100}
          />

          <label htmlFor="service-duration">Duração (minutos)</label>
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
            required
          />

          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={resetForm}>
              Cancelar
            </button>
            <button type="submit" className="primary-button">
              Guardar serviço
            </button>
          </div>
        </form>
      )}

      <div className="service-list">
        {services.length === 0 && (
          <p>Ainda não tens serviços. Cria o primeiro!</p>
        )}

        {services.map((service) => (
          <article className="service-card" key={service.id}>
            <div className="service-info">
              <strong>{service.name}</strong>
              <span>{service.duration} minutos</span>
              <strong className="service-price">{euro.format(service.price)}</strong>
            </div>

            <div className="service-actions">
              <button
                type="button"
                onClick={() => editService(service)}
              >
                Editar
              </button>
              <button
                type="button"
                className="delete-button"
                onClick={() => deleteService(service.id)}
              >
                Eliminar
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
