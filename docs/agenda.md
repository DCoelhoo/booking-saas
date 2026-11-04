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
Na edição do serviço, a opção «Aplicar a duração às marcações futuras» permite
pré-visualizar e confirmar a alteração das horas de fim. São incluídas apenas
marcações que ainda não começaram, usando a hora atual de Europe/Lisbon.
A confirmação revalida a agenda e o horário de funcionamento e aplica o serviço
e as marcações numa transação. Se as marcações afetadas mudarem desde a revisão,
ou surgirem conflitos, a operação inteira é recusada com HTTP 409.
Os nomes dos serviços apresentados correspondem ao nome atual do serviço.

Os endpoints de gestão exigem sessão. O negócio é obtido a partir da conta
autenticada; identificadores enviados pelo cliente não escolhem a organização.
Os dados antigos de `org-demo` mantêm-se separados das novas contas.

Executar `npm test` faz o build e testa serviços e agenda numa D1 local isolada,
incluindo persistência após reinício, concorrência, serviços inativos e âmbito da organização.
Os testes não modificam a base de dados de desenvolvimento.
