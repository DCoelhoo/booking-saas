# Booking SaaS

Aplicação de marcações para diferentes tipos de negócio, com React, TypeScript,
Vite, Cloudflare Workers e D1.

## Desenvolvimento local

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply booking-saas-db --local
npm run dev
```

Abre o endereço apresentado no terminal. Escolhe «Ainda não tenho conta — criar
conta» e preenche o teu nome, o negócio, o link, o email e a palavra-passe.
O registo entra automaticamente na nova conta.
O negócio começa com 14 dias de teste, sem cartão e sem cobrança automática.
O dashboard mostra os dias restantes. Depois do teste, a consulta, a eliminação
de marcações existentes, a gestão da conta e a exportação JSON mantêm-se disponíveis.

Em **Definições** (ou **Mais**, no telemóvel), podes editar o perfil e a identidade
do negócio, ver uma pré-visualização e alterar a palavra-passe.
Em **Horários, pausas e encerramentos**, configura os períodos de cada dia da semana,
as pausas e os dias de férias/encerramento. A agenda usa esses horários para validar
as marcações. Alterações incompatíveis com marcações ainda por concluir são recusadas.
Em **Como os clientes pagam as marcações**, escolhe pagamento no local, total online
ou sinal online (percentagem ou valor fixo). A configuração fica guardada para a
futura página pública; a cobrança online ainda não está ativa. Ver [regras de pagamento](docs/booking-payments.md).

Os emails de criação de conta, alteração de palavra-passe e novas marcações podem
ser testados em **Definições → Emails locais — não enviados**. A alteração de
palavra-passe é confirmada num link com validade de 30 minutos. Os envios reais
dependem da configuração de um domínio remetente; ver [emails](docs/emails.md).

Cada conta começa com um negócio independente. Os serviços e marcações antigos de
`org-demo` mantêm-se na D1, separados das contas novas. O link escolhido fica
reservado; a página pública de marcações será implementada na próxima etapa.

Logótipos podem ser configurados através de um endereço HTTPS existente.
O envio de imagens para R2, a verificação de email e a recuperação de palavra-passe
ficam para as próximas etapas.

## Verificação

```powershell
npm test
npm run lint
```

Os testes fazem o build e usam bases D1 temporárias, sem modificar os teus dados
de desenvolvimento. O estado local de `.wrangler/` é ignorado pelo Git.

Os pagamentos ainda não estão ativos. Os métodos definidos para a integração
são MB WAY, cartões de débito/crédito e referências Multibanco. A escolha do
fornecedor tem de confirmar o suporte a pagamentos B2B e às renovações pretendidas.

Mais detalhes: [contas](docs/accounts.md), [agenda](docs/agenda.md) e [subscrições](docs/subscriptions.md).
