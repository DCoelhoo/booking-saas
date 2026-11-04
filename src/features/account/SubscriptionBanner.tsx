import type { Account } from './accountApi'

export default function SubscriptionBanner({ subscription, onViewPlan }: {
  subscription: Account['subscription']; onViewPlan: () => void
}) {
  const ends = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Lisbon' })
    .format(new Date(subscription.access_until))
  return <section className={`subscription-banner ${subscription.can_manage ? '' : 'subscription-ended'}`} aria-label="Estado da subscrição">
    <div>
      <strong>{subscription.status === 'active' ? 'Subscrição ativa' : subscription.status === 'trialing'
        ? `Tens ${subscription.days_remaining} ${subscription.days_remaining === 1 ? 'dia' : 'dias'} de teste` : 'O período de teste terminou'}</strong>
      <p>{subscription.can_manage ? `Acesso até ${ends}.` : 'Podes consultar, cancelar marcações existentes e exportar os teus dados.'}</p>
    </div>
    <button type="button" className="secondary-button" onClick={onViewPlan}>Ver plano</button>
  </section>
}
