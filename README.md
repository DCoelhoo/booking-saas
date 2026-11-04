# Booking SaaS

Aplicação de marcações para diferentes tipos de negócio, com React, TypeScript,
Vite, Cloudflare Workers e D1.

## Desenvolvimento local

```powershell
npm install
npx wrangler d1 migrations apply booking-saas-db --local
npm run dev
```

Abre o endereço apresentado no terminal. Escolhe «Ainda não tenho conta — criar
conta» e preenche o teu nome, o negócio, o link, o email e a palavra-passe.
O registo entra automaticamente na nova conta.

Em **Definições** (ou **Mais**, no telemóvel), podes editar o perfil e a identidade
do negócio, ver uma pré-visualização e alterar a palavra-passe.

Cada conta começa com um negócio independente. Os serviços e marcações antigos de
`org-demo` mantêm-se na D1, separados das contas novas. O link escolhido fica
reservado; a página pública de marcações será implementada na próxima etapa.

Logótipos podem ser configurados através de um endereço HTTPS existente.
O envio de imagens para R2, a verificação de email e a recuperação de palavra-passe
ficam para as próximas etapas.

## Verificação

```powershell
npm test
npm run lint
```

Os testes fazem o build e usam bases D1 temporárias, sem modificar os teus dados
de desenvolvimento. O estado local de `.wrangler/` é ignorado pelo Git.

Mais detalhes: [contas](docs/accounts.md) e [agenda](docs/agenda.md).
