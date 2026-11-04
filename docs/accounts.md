# Contas e personalização

Cada conta é proprietária de um negócio. O registo cria o utilizador, negócio e
sessão numa transação D1. Não existe associação automática a negócios antigos.
Os dados de `org-demo` mantêm-se intactos, sem atribuição automática de proprietário.

## Endpoints

- `POST /api/auth/register`: `email`, `password`, `full_name`, `business_name`, `slug`.
- `POST /api/auth/login`: `email`, `password`.
- `GET /api/auth/session`: conta e perfil do negócio, ou HTTP 401.
- `POST /api/auth/logout`: invalida a sessão e elimina o cookie.
- `POST /api/auth/password`: `current_password`, `new_password`; invalida todas as
  sessões anteriores e emite uma nova para o dispositivo atual.
- `PATCH /api/profile`: `full_name`, `name`, `slug`, `description`, `contact_email`,
  `phone`, `brand_color`, `logo_url`.

Serviços, agenda e pré-visualização de durações exigem sessão e filtram os dados
pelo negócio da conta. O cliente não consegue escolher outra organização.

## Proteções

Palavras-passe de 12 a 128 caracteres são guardadas com scrypt, salt aleatório e
parâmetros N=16384, r=8, p=5. A configuração está entre as opções recomendadas no
[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
O runtime usa `node:crypto`, suportado pela data de compatibilidade configurada.

Sessões aleatórias de 256 bits têm validade absoluta de sete dias. Apenas o hash
SHA-256 do token fica na D1. O cookie tem HttpOnly, SameSite=Lax e Path=/.
Em HTTPS, usa também Secure e o prefixo `__Host-`; HTTP local usa um cookie de
desenvolvimento separado. As respostas da API têm Cache-Control: no-store.

Pedidos de escrita rejeitam origens diferentes e pedidos cross-site. As operações
com corpo exigem application/json. Login e registo têm limites de tentativas por
IP e por email, com janela de 15 minutos, contabilizados atomicamente na D1.

## Limites desta etapa

O link é único e reservado para a futura página pública, que ainda não é publicada.
Logótipos usam um URL HTTPS existente; upload para R2 fica para a integração seguinte.
O email de acesso não é editável. Verificação de email, recuperação de palavra-passe,
convites de equipa e autenticação de dois fatores ainda não estão implementados.
Não existe publicação automática nesta etapa.

## Testar

Executar `npm test` testa registo, login, cookies, persistência de sessão, perfis,
alteração de palavra-passe, revogação, expiração, limites de tentativas e isolamento
entre duas contas no runtime Cloudflare com D1 isolada. Os testes existentes da
agenda e dos serviços também usam sessões autenticadas.
