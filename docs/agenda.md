# Agenda

`GET /api/bookings?date=YYYY-MM-DD` lista as marcações do dia.
`POST /api/bookings` recebe `customer_name`, `service_id`, `date` e `start_time` (`HH:mm`).
`DELETE /api/bookings/:id` elimina uma marcação, após confirmação na interface.

As datas e horas representam a hora local do negócio. `start_at` e `end_at`
são guardados no formato `YYYY-MM-DDTHH:mm:ss`, sem conversão para UTC.
O horário atual é 09:00–18:00 e existe uma única agenda por organização.
Fusos horários, horários configuráveis e recursos independentes são etapas futuras.

O backend calcula o fim a partir do serviço ativo. A verificação de sobreposição
e a inserção acontecem numa única instrução SQL. Marcações adjacentes são permitidas.
Alterar a duração de um serviço não altera o início ou fim de marcações existentes.
Os nomes dos serviços apresentados correspondem ao nome atual do serviço.

O negócio continua fixo em `org-demo`; a autenticação e a seleção segura do negócio
ainda têm de ser implementadas antes de disponibilizar a gestão publicamente.

Executar `npm test` faz o build e testa serviços e agenda numa D1 local isolada,
incluindo persistência após reinício, concorrência, serviços inativos e âmbito da organização.
Os testes não modificam a base de dados de desenvolvimento.
