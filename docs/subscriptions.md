# Plano e período de teste

O plano definido é de 10 EUR por mês e por negócio. O tratamento de IVA ainda tem
de ser definido antes de apresentar uma cobrança final.

Cada negócio tem 14 dias de teste a partir do registo. Negócios já existentes
recebem os 14 dias completos quando a migração 0003 é aplicada. Entrar novamente
ou editar o perfil não reinicia nem prolonga o teste.

A API calcula o acesso a cada pedido. Depois do teste e sem um período pago
válido, ficam bloqueados a criação de marcações, a edição de serviços e a
personalização do negócio. Permanecem disponíveis a consulta, o cancelamento de
marcações existentes, os dados pessoais da conta, a alteração de palavra-passe,
o fim de sessão e a exportação JSON de todos os serviços e marcações do negócio.

`GET /api/subscription` devolve o estado efetivo. `GET /api/export` exporta os
dados do negócio autenticado. Campos de subscrição não são editáveis pelo cliente.
Operações bloqueadas devolvem HTTP 402 com `code: SUBSCRIPTION_REQUIRED`.

O botão de exportação JSON foi retirado das Definições; o endpoint autenticado
mantém-se disponível. A área «Faturas da subscrição» refere-se exclusivamente à
mensalidade do SaaS. A emissão de faturas dos serviços prestados aos clientes é
responsabilidade de cada negócio e fica fora do âmbito da aplicação.

A área de faturas mostra que a consulta e o download ainda não estão disponíveis.
O histórico e os documentos reais dependem da integração de cobrança e faturação
da subscrição; não são geradas faturas simuladas a partir do estado do plano.

Um período pago só concede acesso até `paid_until` e apenas com estado `active`
ou `canceled` (cancelamento com acesso até ao fim do período pago). Não existe
endpoint público para ativar ou prolongar a subscrição. Esta etapa não processa
pagamentos nem cobra automaticamente. Os campos estão preparados para futura
atualização por notificações autenticadas do fornecedor.

## Requisitos de pagamento aprovados

Os métodos prioritários são MB WAY, cartões de débito/crédito e referências
Multibanco (entidade e referência). O fornecedor ainda não está escolhido.

A aceitação de um pagamento pontual não implica suporte a renovações automáticas.
Referências Multibanco exigem que o cliente efetue o pagamento. O MB WAY dispõe
de Pagamentos Autorizados para subscrições, mas é necessário confirmar a oferta
e a elegibilidade comercial com o fornecedor.

Na documentação consultada, o MB WAY do Stripe é de utilização pontual, sem
cobranças recorrentes e não elegível para B2B. Por isso, não se deve assumir que
Stripe Billing satisfaz o requisito MB WAY para este SaaS dirigido a negócios.

Fontes oficiais consultadas:

- https://docs.stripe.com/payments/mb-way
- https://docs.stripe.com/payments/multibanco
- https://www.mbway.pt/pagamentos-autorizados/

A futura integração deve distinguir renovação automática e pagamento manual,
tratar confirmações assíncronas e notificações duplicadas e só conceder acesso
pago após confirmação autenticada pelo fornecedor. Até lá, a interface indica
que os pagamentos estarão disponíveis em breve.

A página pública de marcações verifica o mesmo acesso e mostra apenas
indisponibilidade temporária ao cliente final, sem expor o estado financeiro do negócio.
