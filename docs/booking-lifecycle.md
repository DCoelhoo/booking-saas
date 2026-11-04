# Estados e gestão de marcações

A migração `0008_booking_lifecycle.sql` mantém as marcações existentes como
`confirmed`. Existem quatro estados: `confirmed`, `completed`, `canceled` e
`no_show`. Os três últimos são finais nesta etapa; a interface pede confirmação
antes de mudar o estado. Concluir ou registar uma falta exige que o fim da
marcação já tenha passado. Cancelar mantém o histórico e liberta o horário.
Marcações canceladas não interferem com disponibilidade nem revisões de duração.

`PATCH /api/bookings/:id` recebe `status` e `version`. Uma versão desatualizada
devolve 409. `DELETE` permanece compatível, mas agora cancela sem apagar. O
cancelamento permanece disponível ao dono depois de expirar a subscrição.
A exportação inclui estados e eventos de alteração, sem tokens privados.

## Links privados para os clientes

As novas reservas públicas incluem no email de confirmação um endereço
`/reserva/gerir#token=...`. O token tem 32 bytes aleatórios; só o hash SHA-256 é
guardado na reserva. O endereço não usa o identificador da reserva como segredo.
O fragmento não é enviado nos pedidos de navegação nem em Referer. A página passa
o token num cabeçalho Authorization: Bearer às APIs; não há cookies de sessão
necessários. O link é válido por 180 dias desde a criação e deve ser privado.
Visitar o link nunca altera a marcação.

- `GET /api/booking-management`: detalhes mínimos, estado, versão e ações permitidas.
- `GET /api/booking-management/slots?date=YYYY-MM-DD`: horários disponíveis para a
  duração da reserva, excluindo a própria reserva da pesquisa de conflitos.
- `POST /api/booking-management`: recebe `action` (`canceled` ou `reschedule`),
  `version` e, ao reagendar, `date` e `start_time`.

Em Definições, o dono escolhe uma antecedência de 0 a 720 horas; o valor inicial
é 24 horas. O prazo aplica-se às reservas existentes e é mostrado antes da
confirmação e na página de gestão. O limite é exclusivo: com 0 horas, as alterações
terminam no início da marcação. Dentro do prazo bloqueado, o cliente contacta o
negócio. O prazo usa as horas civis do negócio em Europe/Lisbon, tal como a agenda.

Reagendar exige uma marcação confirmada, serviço ativo e acesso de gestão ativo
do negócio. Mantém o serviço, duração atual da reserva e preço acordado; a nova
data deve estar nos próximos 90 dias. O backend revalida horário, pausas,
encerramentos, intervalos de 15 minutos, versão, prazo e conflitos dentro da
escrita. Se falhar, a reserva original permanece intacta. Cancelar não depende de
o serviço ou a subscrição ainda estarem ativos.

Cada alteração cria um evento com os horários anterior e novo, autor e versão.
A alteração, o evento e os avisos para negócio e cliente são uma transação D1.
Pedidos concorrentes com a mesma versão só podem produzir uma alteração.
Não se cobram taxas nem se processam reembolsos nesta etapa.

## Testes locais e limites

Executa `npm run dev`, cria uma reserva pública futura e abre Definições →
Emails locais — não enviados → Gerir marcação de teste. Isto exige o modo local
de pré-visualização de emails já configurado. Reservas anteriores a esta migração
continuam geridas pelo dono; não recebem retroativamente links nem emails.
O envio real depende ainda do domínio e remetente configurados.

`npm test` cobre estados finais, isolamento, histórico, prazos, tokens inválidos
e expirados, concorrência, cancelamento após expirar a subscrição, libertação de
horários e conservação da reserva quando um reagendamento falha.
