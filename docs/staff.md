# Colaboradores e agendas individuais

Cada estabelecimento tem até 5 perfis, incluindo o perfil inicial associado ao
dono. Perfis inativos também contam para o limite; são mantidos para preservar o
histórico. O limite é revalidado na instrução de criação, incluindo pedidos
simultâneos. Os serviços, preços, horários e encerramentos são partilhados nesta
etapa. Cada colaborador tem capacidade própria para uma marcação de cada vez.

## Acessos

O dono vê todas as agendas, filtra por colaborador, gere serviços, equipa,
definições e acede à página própria de Faturas. O colaborador vê apenas a sua
agenda e as opções da sua conta. Pode criar e alterar estados das suas marcações,
respeitando o acesso do estabelecimento. Não pode consultar ou alterar marcações
de outros colaboradores, gerir a equipa, exportar dados, consultar emails locais,
alterar definições do negócio ou consultar faturação. A API aplica estas restrições
mesmo que o cliente altere IDs ou pedidos. A recuperação de acesso é individual;
pedidos de um colaborador não invalidam os links dos restantes utilizadores.

Em Colaboradores, o dono indica nome público e email. O convite tem um token
aleatório de 32 bytes, só o hash é guardado na tabela de convites e expira em 7
dias. A aceitação cria uma conta com papel `staff` e permite escolher a própria
palavra-passe. Cada convite só pode ser aceite uma vez. Reenviar invalida o token
anterior; emails já associados a contas não podem ser reutilizados. Nesta versão
cada conta pertence a um único estabelecimento.

Desativar bloqueia novas reservas e o acesso do colaborador, revoga as suas
sessões, links de palavra-passe e convites pendentes. Reativar não restaura sessões
anteriores. As marcações existentes não são canceladas automaticamente: o dono
continua a vê-las e pode cancelar. O cliente ainda pode cancelar pelo link dentro
do prazo, mas não reagendar com um colaborador inativo.

## Reservas

O cliente entra no link do estabelecimento e escolhe colaborador, serviço,
dia/hora e contactos. Os horários e a escrita atómica verificam conflitos apenas
na agenda escolhida. Dois colaboradores podem receber marcações em simultâneo;
a mesma pessoa não pode receber marcações sobrepostas. O reagendamento mantém o
colaborador da reserva. A revisão de duração dos serviços também valida conflitos
por colaborador. Não existem horários pessoais, serviços exclusivos, transferência
de reservas entre colaboradores ou agendas de recursos nesta etapa.

A confirmação identifica o colaborador. Novas reservas notificam o negócio e,
se já tiver conta, o colaborador atribuído. A identificação do colaborador também
é guardada na reserva e aparece na agenda e na exportação autenticada do dono.

## Migração e desenvolvimento

A migração `0010_staff.sql` cria o perfil inicial e associa-lhe todas as marcações
existentes. Reconstrói as tabelas de contas, sessões e tokens para permitir várias
contas por organização, mantendo emails únicos e apenas um dono por organização.
Os testes verificam que sessões, tokens, palavras-passe e histórico são preservados.

Aplica as migrações locais e executa `npm run dev`. Em modo preview, os convites
aparecem em Definições → Emails locais — não enviados → Abrir convite de
colaborador. O endereço APP_URL deve apontar ao servidor local correto. O envio
real continua dependente do domínio remetente.

APIs: `GET /api/staff`, `POST /api/staff` (nome/email), `PATCH /api/staff/:id`
(nome/is_active), `POST /api/staff/:id` (reenviar convite) e
`POST /api/auth/invitation/accept` (token/new_password). A criação de reservas
aceita `staff_id`; a consulta pública de horários aceita esse mesmo parâmetro.
Clientes antigos sem esse campo usam o perfil inicial. O frontend público exige
escolha explícita. Identificadores de outros estabelecimentos são recusados.
