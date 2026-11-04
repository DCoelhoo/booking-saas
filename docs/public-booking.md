# Página pública de marcações

O link de cada negócio é `/<slug>`; `/` continua a ser a área de gestão.
Em Definições, a secção «A tua página de marcações» permite abrir e copiar o
endereço guardado. Só são encontrados negócios associados a uma conta.

A página usa o nome, descrição, logótipo, cor e contactos públicos configurados.
O cliente não precisa de conta: escolhe um serviço ativo, data, horário e indica
nome, email e telefone opcional. Reservas são persistidas na mesma agenda do dono.

## Disponibilidade e pagamentos

Horários são apresentados em Europe/Lisbon, em intervalos de 15 minutos a partir
do início de cada período de funcionamento. Só são oferecidos horários futuros
nos próximos 90 dias que acomodem toda a duração do serviço. Pausas, férias,
dias encerrados e marcações existentes são respeitados.

O backend revalida disponibilidade, sobreposições, serviço ativo, preço, duração,
acesso do negócio e pagamento na mesma instrução que insere a marcação. Um
horário mostrado livre pode deixar de estar disponível; nesse caso a interface
pede uma nova escolha. Reservas com preço ou duração diferentes dos revistos pelo
cliente são recusadas. A agenda pública não expõe nomes ou contactos de clientes.

Pagamento no local permite confirmar sem cobrança. Serviços gratuitos também.
Enquanto o fornecedor não estiver integrado, serviços que exigem sinal ou total
online aparecem temporariamente indisponíveis, sem simular pagamentos concluídos.
A expiração do teste/subscrição apresenta apenas indisponibilidade genérica ao
cliente final, sem expor informação financeira do negócio.

As reservas públicas guardam uma cópia do nome do serviço, preço e condições de
pagamento acordados. Alterações posteriores ao serviço não alteram estes valores.
O estado devolvido é `not_collected`: uma confirmação de reserva não é um recibo
nem uma confirmação de pagamento.

## API e proteção de dados

- `GET /api/public/:slug`: perfil público e serviços ativos, sem sessão.
- `GET /api/public/:slug/slots?service_id=...&date=YYYY-MM-DD`: horários livres,
  sem dados de clientes nem motivos privados dos encerramentos.
- `POST /api/public/:slug/bookings`: recebe serviço, data, hora, contactos,
  preço/duração esperados e `request_id` aleatório de 32 a 64 caracteres.

O mesmo pedido pode ser repetido sem criar duas reservas. A chave é guardada por
negócio, juntamente com um hash dos dados do pedido. Uma chave com dados diferentes
é recusada. A resposta contém a referência e os detalhes do compromisso, sem
devolver contactos ou outros dados pessoais. Não existe endpoint público para
listar ou consultar clientes e reservas por identificador.

Os pedidos de escrita exigem JSON, rejeitam origem diferente e têm um campo
anti-bot invisível. Existem limites de 30 tentativas por IP e 5 por email/negócio
em 15 minutos. Estes limites são proteção inicial, não substituem uma política de
anti-abuso mais completa à medida que o produto ganha tráfego.

O utilizador do negócio vê os contactos da reserva na sua agenda e na exportação
autenticada. Identificadores de outra organização enviados no corpo não escolhem
o negócio: a organização é sempre obtida pelo slug do endereço.

## Emails e confirmação

A transação cria a reserva e os dois avisos: notificação ao negócio e confirmação
ao cliente. Repetir o pedido não volta a criar avisos. O email do cliente inclui
serviço, data, hora, valor no local e referência. O envio real continua dependente
do domínio remetente; a interface fornece a referência mesmo sem email.

As novas reservas incluem um link privado para o cliente cancelar ou reagendar,
respeitando o prazo configurado pelo negócio. Consulta [gestão de marcações](booking-lifecycle.md).

## Desenvolvimento

Executa as migrações locais e `npm run dev`. Abre Definições, copia o link público
e testa com dados fictícios. `npm test` inclui concorrência, idempotência, privacidade,
horários, preços, serviços inativos, subscrição e bloqueio de pagamentos online.
Esta alteração não publica a aplicação na Internet.
