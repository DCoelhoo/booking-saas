# Pagamento dos serviços pelos clientes

Cada negócio escolhe em Definições → «Como os clientes pagam as marcações»:

- `on_site`: o cliente paga a totalidade no local (modo inicial).
- `full_online`: a confirmação da reserva requer pagamento integral online.
- `deposit`: a confirmação requer um sinal online, descontado do preço total;
  o restante é pago no local.

O sinal pode ser uma percentagem inteira de 1 a 99 ou um valor fixo em euros.
Valores fixos são guardados em cêntimos. O sinal nunca ultrapassa o preço do
serviço. Num serviço abaixo do valor fixo do sinal, paga-se apenas o preço total.
Serviços gratuitos não exigem pagamento. Os cálculos são feitos em cêntimos,
arredondados ao cêntimo mais próximo; um sinal de serviço não gratuito é de pelo
menos um cêntimo. Sinal e restante somam sempre o preço total.

Estas regras são independentes da mensalidade de 10 EUR do SaaS. Não representam
pagamentos feitos, taxas adicionais ou autorização para cobrar um cartão.

## API

- `GET /api/booking-payment-settings`: consulta as regras do negócio autenticado.
- `PUT /api/booking-payment-settings`: grava `mode`, `deposit_type` (`percentage`
  ou `fixed`) e `deposit_value` (percentagem inteira ou cêntimos). A alteração exige
  acesso de gestão ativo. Identificadores de negócio recebidos do cliente são ignorados.
- `GET /api/services/:id/payment-quote`: calcula o total, o valor online e o
  restante no local, usando o preço real do serviço ativo do negócio autenticado.

A exportação JSON inclui a configuração. Sair e entrar, ou reiniciar o runtime,
não altera as regras. Após o teste, a consulta permanece disponível e a edição
é bloqueada. Estas alterações não modificam marcações antigas.

## Estado atual e integração futura

As cobranças online ainda não estão disponíveis. A interface permite guardar a
preferência para preparar a página pública e mostra essa limitação. Marcações
internas no dashboard continuam possíveis; não efetuam nem confirmam pagamentos.
A simulação apresentada num formulário é apenas a regra atual, não um recibo.

O endpoint de simulação devolve `online_payments_available: false`. O campo
`can_confirm_public_booking` só pode ser verdadeiro com acesso de gestão ativo
e sem valor online exigido. Esse indicador não substitui a validação de horários,
conflitos ou outros dados da reserva na futura página pública.

Antes de aceitar reservas online com sinal ou pagamento integral, a integração
tem de ligar a conta de pagamentos do negócio, recalcular os valores no servidor,
guardar o preço e a regra acordados na reserva e esperar pela confirmação autenticada
do fornecedor. Não se deve confirmar uma reserva paga pelo simples retorno do browser
do checkout. A mensalidade do SaaS e os pagamentos dos serviços pertencem a fluxos
separados, com destinatários financeiros diferentes.
