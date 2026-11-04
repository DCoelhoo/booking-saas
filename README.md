# Giro

Aplicação de marcações para diferentes tipos de negócio, com React, TypeScript,
Vite, Cloudflare Workers e D1.

## Desenvolvimento local

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply booking-saas-db --local
npm run dev
```

Abre o endereço apresentado no terminal para ver a página de apresentação.
Escolhe «Experimentar» para criar conta ou «Entrar» para abrir a área de gestão
em `/conta`. Preenche o teu nome, o negócio, o link, o email e a palavra-passe.
O registo entra automaticamente na nova conta.
O negócio começa com 14 dias de teste, sem cartão e sem cobrança automática.
O dashboard mostra os dias restantes. Depois do teste, a consulta, o cancelamento
de marcações existentes, a gestão da conta e a exportação JSON mantêm-se disponíveis.

Em **Definições** (ou **Mais**, no telemóvel), podes editar o perfil e a identidade
do negócio, ver uma pré-visualização e alterar a palavra-passe.
Em **Horários, pausas e encerramentos**, configura os períodos de cada dia da semana,
as pausas e os dias de férias/encerramento. A agenda usa esses horários para validar
as marcações. Alterações incompatíveis com marcações ainda por concluir são recusadas.
Em **Como os clientes pagam as marcações**, escolhe pagamento no local, total online
ou sinal online (percentagem ou valor fixo). A configuração fica guardada para a
página pública; a cobrança online ainda não está ativa. Ver [regras de pagamento](docs/booking-payments.md).

Os emails de criação de conta, alteração de palavra-passe e novas marcações podem
ser testados em **Definições → Emails locais — não enviados**. A alteração de
palavra-passe é confirmada num link com validade de 30 minutos. Os envios reais
dependem da configuração de um domínio remetente; ver [emails](docs/emails.md).

Cada conta começa com um negócio independente. Os serviços e marcações antigos de
`org-demo` mantêm-se na D1, separados das contas novas. Em **A tua página de marcações**,
abre ou copia o link `/<slug>` para testar reservas sem conta. A página usa a
personalização do negócio, horários reais e recolhe os contactos do cliente.
Pagamento no local e serviços gratuitos podem ser reservados; serviços com
pagamento antecipado aguardam a integração do fornecedor. Ver [página pública](docs/public-booking.md).

Na agenda, as marcações podem ser concluídas, canceladas ou assinaladas como falta
de comparência, mantendo o histórico. As novas reservas públicas incluem um link
privado no email para cancelar ou reagendar. O prazo inicial é de 24 horas e pode
ser alterado em Definições. Ver [gestão de marcações](docs/booking-lifecycle.md).

Logótipos podem ser configurados através de um endereço HTTPS existente.
Em **Colaboradores**, convida até 5 perfis por estabelecimento, incluindo o
perfil inicial. Cada colaborador tem acesso apenas à sua agenda. Os clientes
escolhem o colaborador na página pública antes de reservar. Ver [equipa](docs/staff.md).
Em **Pré-visualização**, o dono pode explorar a página pública em formato de
telemóvel (390 px) ou computador (1280 px). A tab substitui a antiga área Clientes.
Usa os dados reais guardados, com envio de reservas desativado. Atualiza ao abrir
a tab, ao regressar à tab do browser e quando são guardadas alterações noutra janela do
mesmo browser e endereço. Também permite atualizar manualmente ou abrir a página
pública. Não mostra alterações ainda por guardar; uma atualização reinicia o
percurso da reserva dentro da pré-visualização, mantendo o formato escolhido.
As faturas da mensalidade têm uma página própria em **Faturas**; os documentos
reais continuam pendentes da integração de cobrança e faturação do SaaS.
Em **Definições → A tua fotografia**, donos e colaboradores podem enviar ou remover
a sua fotografia pessoal, visível também na página de reservas. As imagens usam R2
local em desenvolvimento. Ver [fotografias](docs/profile-photos.md).
Em **Definições → Google Calendar e Apple/iCloud**, cada pessoa pode criar um
link privado para subscrever a sua agenda no calendário pessoal. A ligação é de
leitura e requer uma aplicação publicada em HTTPS para funcionar nesses serviços.
Ver [calendários](docs/calendar.md).
Em **Definições → Imagens do estabelecimento**, o dono pode enviar uma capa opcional e uma fotografia circular para a página pública. Sem imagens, aparecem um fundo com a cor do negócio e as iniciais. As fotografias usam o mesmo armazenamento R2 das imagens pessoais. A verificação de email continua pendente.
A recuperação de palavra-passe está disponível no login. Os lembretes por email
são preparados cerca de 24 horas antes da marcação; podem ser testados nas
Definições em modo local. Ver [emails](docs/emails.md) e [lembretes](docs/reminders.md).

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
