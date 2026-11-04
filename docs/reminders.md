# Lembretes automáticos

A migração `0009_booking_reminders.sql` associa cada lembrete à referência,
versão e horário da reserva. O cron de cinco minutos prepara os lembretes e
processa a fila de email. Não depende de alguém ter a aplicação aberta.

Nesta etapa há um lembrete por email, cerca de 24 horas antes, para marcações
confirmadas com email de cliente. Não há SMS nem WhatsApp. Reservas criadas ou
reagendadas a menos de 24 horas do início recebem apenas a confirmação/aviso da
alteração. As marcações internas sem email de cliente não recebem lembretes.
O acesso do negócio ter expirado não remove os lembretes de compromissos existentes.

Os horários guardados continuam civis em Europe/Lisbon. Para as 24 horas e a
expiração da mensagem, convertem-se para um instante respeitando o horário de
verão. Horas civis inexistentes na mudança de primavera não geram lembrete.

Cada execução seleciona até 100 versões elegíveis ainda não processadas.
A chave `booking-reminder:<id>:<version>` evita criar duas mensagens para a mesma
versão. Versões criadas com pouca antecedência ficam registadas como ignoradas,
com estado `expired` e sem conteúdo. Se o cron tiver estado parado, pode preparar
lembretes em atraso, mas nunca depois do início da reserva. O conteúdo inclui
serviço, data, hora, contactos públicos e referência; não altera o preço nem
introduz novos links de acesso à reserva.

Cancelar, concluir ou registar falta invalida os lembretes pendentes na mesma
transação. O reagendamento invalida a versão anterior; a nova é avaliada para o
novo horário. A fila também revalida estado, versão, horário e expiração antes de
reservar cada tentativa de envio, incluindo repetições após falha do fornecedor.
Uma mensagem já entregue ao fornecedor não pode ser retirada. A fila mantém as
garantias e limites de repetição descritos em [emails](emails.md).

## Testar localmente

Aplica as migrações locais e usa `EMAIL_MODE=preview`. Em Definições → Emails
locais — não enviados, «Processar lembretes locais» processa o negócio atual.
Só aparecem mensagens de reservas confirmadas nas próximas 24 horas, criadas ou
reagendadas com antecedência suficiente. Executar o botão repetidamente não cria
duplicados. O endpoint `POST /api/reminders/preview-run` exige sessão e não existe
em hosts de produção ou sem modo preview.

Os testes usam bases temporárias e um relógio controlado para validar horários,
cancelamento, reagendamento, concorrência e falhas do fornecedor, sem esperar um
dia e sem enviar emails reais. O envio real continua pendente do domínio remetente.
