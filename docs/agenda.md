# Agenda

`GET /api/bookings?date=YYYY-MM-DD` lista as marcações do dia.
`POST /api/bookings` recebe `customer_name`, `service_id`, `date` e `start_time` (`HH:mm`).
`PATCH /api/bookings/:id` altera o estado com controlo de versão. `DELETE` cancela
sem apagar o histórico. Consulta [estados e gestão pelo cliente](booking-lifecycle.md).

As datas e horas representam a hora local do negócio. `start_at` e `end_at`
são guardados no formato `YYYY-MM-DDTHH:mm:ss`, sem conversão para UTC.
Existe uma única agenda por organização. Os horários são configuráveis nas
Definições, em «Horários, pausas e encerramentos». Europe/Lisbon mantém-se como
fuso de referência; a escolha de outros fusos e recursos independentes são etapas futuras.

`GET /api/availability` consulta o horário do negócio autenticado.
`PUT /api/availability` guarda `weekly` (sete listas de períodos `start`/`end`,
com domingo no índice 0) e `closures` (`start_date`, `end_date`, `reason`).
Um dia sem períodos está encerrado. São permitidos até oito períodos por dia
e cem encerramentos adicionais. Pausas são os espaços entre períodos.
Encerramentos incluem as duas datas; um dia isolado usa início e fim iguais.
Os períodos não podem atravessar a meia-noite. Períodos contíguos são unidos.

O horário inicial de 09:00–18:00 em todos os dias preserva o comportamento anterior.
O negócio pode fechá-los ou ajustá-los. A gravação de horários e a validação de
marcações existentes acontecem na mesma instrução SQL. Alterações que deixem
marcações ainda por concluir fora da disponibilidade são recusadas com HTTP 409,
sem modificar os horários nem apagar marcações. A resposta mostra até 50 conflitos.
Pedidos simultâneos de nova marcação e alteração de horários também são validados
na base de dados. A agenda mostra os períodos do dia e impede novas marcações em
dias encerrados; o backend revalida sempre o período completo da marcação.
Após o teste, os horários continuam consultáveis, mas só podem ser alterados com
acesso de gestão ativo. A exportação JSON inclui a configuração de disponibilidade.

O backend calcula o fim a partir do serviço ativo. A verificação de sobreposição
e a inserção acontecem numa única instrução SQL. Marcações adjacentes são permitidas.
Alterar a duração de um serviço não altera o início ou fim de marcações existentes.
Na edição do serviço, a opção «Aplicar a duração às marcações futuras» permite
pré-visualizar e confirmar a alteração das horas de fim. São incluídas apenas
marcações que ainda não começaram, usando a hora atual de Europe/Lisbon.
A confirmação revalida a agenda e o horário de funcionamento e aplica o serviço
e as marcações numa transação. Se as marcações afetadas mudarem desde a revisão,
ou surgirem conflitos, a operação inteira é recusada com HTTP 409.
Nas marcações internas, os nomes correspondem ao nome atual do serviço. As reservas públicas guardam o nome, o preço e a regra de pagamento acordados na confirmação.

Os endpoints de gestão exigem sessão. O negócio é obtido a partir da conta
autenticada; identificadores enviados pelo cliente não escolhem a organização.
Os dados antigos de `org-demo` mantêm-se separados das novas contas.

Executar `npm test` faz o build e testa serviços e agenda numa D1 local isolada,
incluindo persistência após reinício, concorrência, serviços inativos e âmbito da organização.
Os testes não modificam a base de dados de desenvolvimento.
