# Fotografias pessoais

Em Definições → A tua fotografia, cada dono ou colaborador pode enviar, substituir
ou remover a sua fotografia. A fotografia é independente do logótipo do negócio.
Aparece nos avatares da conta, na lista da equipa e na seleção pública do
colaborador. Sem imagem, ou se o carregamento falhar, mostram-se as iniciais.
O formulário informa que a imagem fica visível publicamente.

O browser aceita JPG, PNG ou WebP até 10 MB, recorta o centro para um quadrado de
512 × 512 e converte para JPEG, sem os metadados originais. Não existe editor
manual de recorte nesta etapa. A API aceita apenas JPEG até 256 KB e 1024 píxeis
por lado, verificando assinatura, marcadores e dimensões antes de guardar.

## Armazenamento e acessos

As imagens são guardadas no Cloudflare R2 pelo binding `PROFILE_PHOTOS`. A D1
guarda apenas `staff_members.photo_key`, introduzido na migração
`0011_profile_photos.sql`. O bucket não necessita de acesso público direto.

- `POST /api/me/photo`: JSON com `image` em base64, sem prefixo data URL.
- `DELETE /api/me/photo`: remove a fotografia do utilizador autenticado.
- `GET /api/staff-photos/:uuid.jpg`: disponibiliza apenas a fotografia ainda
  referenciada pelo perfil, com Content-Type image/jpeg e nosniff.

O alvo é sempre obtido da sessão. Não se pode escolher outra pessoa nem outro
estabelecimento através do corpo do pedido. As alterações pessoais permanecem
disponíveis depois de terminar o período pago/de teste. Aplicam-se proteção de
origem, tamanho máximo do pedido e limite de 20 alterações em 15 minutos.

A substituição usa uma chave nova e uma atualização condicional da referência.
Uma alteração concorrente pode devolver 409, mantendo o ficheiro que venceu.
As referências antigas deixam de ser servidas imediatamente; os objetos antigos
são removidos do R2. Se a limpeza falhar, um objeto órfão permanece privado no
bucket e não fica acessível pela API. Não se reutilizam endereços de imagens.

Fotografias de colaboradores inativos não são disponibilizadas anonimamente;
o dono ainda pode vê-las autenticado. Desativar não elimina a fotografia nem o
histórico. Remover a fotografia elimina a referência e tenta remover o objeto.

## Desenvolvimento e produção

O binding já está declarado em wrangler.jsonc com o bucket
`booking-saas-profile-photos`. Em desenvolvimento, Vite/Miniflare usam R2 local,
sem enviar imagens para a Cloudflare. Aplica as migrações e executa `npm run dev`.

Antes de publicar em produção, é necessário criar o bucket R2 na conta Cloudflare
e confirmar que o nome corresponde ao binding. Esta alteração não criou um bucket
remoto nem publicou a aplicação. D1 e R2 precisam de ser incluídos no plano de
backup: a exportação JSON da base não contém os ficheiros das fotografias.

Os testes usam uma imagem fictícia e armazenamento temporário. Cobrem isolamento,
assinaturas e tamanhos inválidos, substituição, remoção, perfis inativos,
persistência após reinício e ausência de acesso a referências antigas.

## Fotografias do estabelecimento

Em Definições → Imagens do estabelecimento, o dono pode enviar, substituir e
remover uma capa opcional e uma fotografia de perfil circular. A capa é recortada
ao centro para 1024 × 400; a fotografia de perfil usa 512 × 512. Aplicam-se os
mesmos limites e validações das fotografias pessoais. Não existe editor manual
de recorte. Os envios são guardados imediatamente e atualizam a pré-visualização.

A migração 0013_business_photos.sql adiciona cover_photo_key e profile_photo_key
a organizations. O mesmo bucket R2 usa o prefixo business/. Os endpoints são
POST/DELETE /api/business/photos/cover e /api/business/photos/profile; a leitura
pública é GET /api/business-photos/:uuid.jpg, apenas para referências atuais.
O estabelecimento vem sempre da sessão, e colaboradores não podem alterar estas
imagens. O envio exige teste/subscrição ativa; a remoção continua disponível
depois da expiração. A substituição também protege contra alterações concorrentes.

Sem capa, a página mostra um fundo com a cor do negócio. Sem fotografia de perfil,
usa o logótipo HTTPS existente ou as iniciais. A apresentação pública mostra apenas
o nome, os contactos recolhidos numa secção expansível e o formulário de marcação.
