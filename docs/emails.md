# Emails transacionais

Eventos implementados:

- Registo: mensagem de boas-vindas para o email de acesso.
- Pedido autenticado de alteração de palavra-passe: link para o email de acesso,
  depois de validar a palavra-passe atual. Não contém a palavra-passe nova ou antiga.
- Confirmação da nova palavra-passe: aviso de segurança e fim de todas as sessões.
- Nova marcação: aviso para o email de contacto do negócio ou, se vazio, para o
  email de acesso. Inclui cliente, serviço, data e início/fim no horário do negócio.

Esta etapa não envia confirmações ao cliente da marcação, pois ainda não é
recolhido o email desse cliente. O email de boas-vindas não verifica a titularidade
do endereço, e a recuperação de palavra-passe sem a palavra-passe atual ainda
é uma funcionalidade distinta a implementar.

## Teste local, sem envio real

```powershell
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply booking-saas-db --local
npm run dev
```

Em Definições, abre «Emails locais — não enviados». Cria uma conta ou uma marcação
para gerar mensagens. Pede um link de alteração de palavra-passe e abre o link da
pré-visualização para testar a confirmação. Usa apenas contas e dados fictícios.
APP_URL deve corresponder ao endereço local em que pretendes abrir a aplicação.

A pré-visualização só existe com EMAIL_MODE=preview e num hostname local. O endpoint
GET /api/email-previews exige sessão e filtra pelo negócio autenticado. Mensagens
de preview ficam marcadas como tal e nunca são enviadas se o modo live for ativado.

## Ativar envios reais quando existir domínio

O projeto está preparado para a API nativa de Cloudflare Email Service. Ainda é
necessário ter um domínio na Cloudflare DNS e ativar Email Sending para esse
domínio, verificando SPF, DKIM e DMARC segundo o assistente do serviço.

Configura em produção:

- EMAIL_MODE=live
- EMAIL_FROM=Booking SaaS <notificacoes@teudominio.pt>
- APP_URL=https://endereco-real-da-aplicacao

O binding EMAIL e um cron de cinco em cinco minutos estão declarados no Wrangler.
Não uses remote=true em desenvolvimento se não pretenderes enviar mensagens reais.
Não existem credenciais nem remetentes de produção neste repositório. .dev.vars
está excluído do Git. Não foi publicado nem testado envio para caixas reais.

Sem configuração de envio, registos e marcações mantêm os avisos pendentes na
fila, mas os pedidos de alteração de palavra-passe devolvem HTTP 503, evitando
indicar que foi enviado um link que o utilizador não conseguirá receber.

## Entrega e segurança

A criação da conta/marcação e o respetivo aviso são gravados na mesma transação D1.
A fila email_outbox sobrevive a reinícios. Pedidos e cron processam até 20 mensagens
por execução; falhas têm espera exponencial e até oito tentativas. Jobs com uma
tentativa em curso usam uma reserva de dois minutos para evitar dois envios em
paralelo. Uma falha entre aceitação pelo fornecedor e gravação da confirmação pode
ainda causar uma entrega repetida, como em qualquer processamento at-least-once
sem idempotência no fornecedor.

Mensagens aceites pelo fornecedor ficam como sent, o que não garante entrega na
caixa de entrada. Em produção, acompanha falhas e rejeições no Cloudflare Email
Service e os estados failed da fila. O corpo é removido após aceitação do envio;
registos concluídos, expirados, de preview ou falhados são removidos após 30 dias.

Links de palavra-passe usam tokens aleatórios de 256 bits, de utilização única e
validade de 30 minutos. A tabela de autorização guarda apenas o hash do token.
A fila contém temporariamente o link necessário para enviar a mensagem e não é
exposta em produção. Um novo pedido invalida o anterior. A confirmação revalida o
token e a versão da palavra-passe na transação, revoga as sessões e remove os
pedidos anteriores. Os tokens não aparecem em logs nem nas respostas públicas.

O token viaja no fragmento do link, sem ser enviado no URL do pedido inicial.
A interface retira-o da barra de endereço e só o envia ao confirmar pelo POST.
Abrir o email ou o link não altera a palavra-passe por si só.

Referências oficiais:

- https://developers.cloudflare.com/email-service/get-started/send-emails/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
