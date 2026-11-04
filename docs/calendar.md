# Google Calendar e Calendário Apple/iCloud

A ligação é uma subscrição iCalendar de leitura. Cada dono ou colaborador cria um
link privado em Definições e adiciona-o ao Google Calendar ou à aplicação
Calendário da Apple. Não pede credenciais desses serviços, não importa compromissos
pessoais e não altera a disponibilidade de reservas.

O calendário inclui apenas as marcações atribuídas ao perfil da pessoa, mesmo
quando se trata do dono. Inclui os 90 dias anteriores e os próximos 365 dias.
Os eventos mostram nome do serviço, nome do cliente, horário e estado. Não
incluem email, telefone nem links privados de gestão da reserva. A frequência
de atualização depende do serviço que consulta a subscrição; não é uma ligação
instantânea nem uma garantia de entrega de notificações.

## Como adicionar

1. Abre Definições → Google Calendar e Apple/iCloud.
2. Confirma que pretendes criar um link privado e cria-o.
3. Copia o link e adiciona uma subscrição pelo URL, sem o publicar ou partilhar.

No Google Calendar, usa um browser no computador: Outros calendários → adicionar
calendário a partir de URL. No Calendário da Apple, adiciona uma subscrição e
escolhe a conta/localização iCloud para a veres nos dispositivos da mesma conta.
No Mac, a opção encontra-se em Ficheiro → Nova subscrição de calendário. Não é
necessário usar a palavra-passe principal da Apple nem criar uma password específica.

Fontes oficiais:

- [Google: adicionar um calendário por URL](https://support.google.com/calendar/answer/37100).
- [Apple: subscrições de calendário em iCloud](https://support.apple.com/en-us/102301).
- [iCalendar, RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html).

## Segurança e ciclo de vida

A migração `0012_calendar_subscriptions.sql` guarda um hash SHA-256 de um token
aleatório de 32 bytes, associado à conta. O link completo só é mostrado na criação;
não é recuperável pela consulta de estado. Quem tiver esse link pode ler os eventos
sem sessão: trata-o como um segredo. O atributo CLASS:PRIVATE é uma indicação para
os clientes de calendário, não um mecanismo de controlo de acesso.

Criar outro link invalida o anterior e exige adicionar novamente a subscrição nos
serviços externos. Desativar o link bloqueia novas consultas, mas não apaga cópias
já descarregadas: o utilizador deve remover também a subscrição no Google/Apple.
Desativar um colaborador revoga o link permanentemente; reativar o perfil não
recupera o link anterior. Terminar o teste ou a subscrição do SaaS não interrompe
a consulta das marcações existentes.

Os eventos têm UID estável e SEQUENCE baseado na versão da marcação. Um
reagendamento altera o mesmo evento; um cancelamento mantém o UID e passa a
STATUS:CANCELLED. A apresentação final dos cancelamentos depende do cliente de
calendário. Horários são convertidos de Europe/Lisbon para UTC, respeitando o
horário de verão. Horas civis inexistentes não são exportadas.

Não existe envio de emails de convite nem pedidos de confirmação para os clientes
das marcações. Não há ligações de escrita aos calendários pessoais.

## Desenvolvimento e publicação

Executa as migrações locais e `npm run dev`. Os links localhost/127.0.0.1 permitem
testar o conteúdo do feed, mas não são alcançáveis pelo Google/Apple na Internet.
É preciso publicar a aplicação num endereço HTTPS público para uma subscrição real.
Em produção, APP_URL deve corresponder ao endereço público canónico, se definido.
Não foi criada nem ligada qualquer conta externa automaticamente.

APIs:

- `GET /api/me/calendar`: estado do link da própria pessoa, com sessão.
- `POST /api/me/calendar`: recebe `confirm_private_link: true` e cria/substitui o link.
- `DELETE /api/me/calendar`: revoga o link da própria pessoa.
- `GET` ou `HEAD /api/calendar-feed/:token.ics`: feed sem sessão, autenticado pelo token.

Os testes cobrem isolamento, revogação, substituição do token, persistência,
estados, reagendamento, horário de verão e escape/folding de texto UTF-8 para
evitar conteúdo iCalendar injetado através de nomes.
