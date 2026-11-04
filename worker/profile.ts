import type { D1Database } from '@cloudflare/workers-types'
import { getAccount, jsonBody, validEmail, validSlug, type Account } from './auth.ts'
import { subscriptionRequired } from './subscriptions.ts'

export async function updateProfile(request: Request, db: D1Database, account: Account): Promise<Response> {
  const body = await jsonBody(request)
  if (!body) return Response.json({ error: 'Dados inválidos.' }, { status: 400 })
  if (body.logo_url !== undefined && body.logo_url !== '') return Response.json({ error: 'Envia a imagem do estabelecimento através do upload nas Definições.' }, { status: 400 })
  const { full_name, name, slug, description, contact_email, phone, brand_color } = body
  if (!account.subscription.can_manage && Object.entries({ name, slug, description, contact_email, phone, brand_color })
    .some(([key, value]) => value !== account.organization[key as keyof Account['organization']])) {
    return subscriptionRequired()
  }
  if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 100 ||
      typeof name !== 'string' || !name.trim() || name.trim().length > 100 || !validSlug(slug) ||
      typeof description !== 'string' || description.length > 1000 ||
      typeof contact_email !== 'string' || (contact_email !== '' && !validEmail(contact_email)) ||
      typeof phone !== 'string' || phone.length > 40 ||
      typeof brand_color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(brand_color)) {
    return Response.json({ error: 'Verifica os dados. O link deve ter 3 a 63 letras minúsculas, números ou hífenes e não pode usar nomes reservados.' }, { status: 400 })
  }
  try {
    const occupied = await db.prepare('SELECT id FROM organizations WHERE slug = ? AND id != ?')
      .bind(slug, account.organization.id).first()
    if (occupied) return Response.json({ error: 'Este link já está em uso. Escolhe outro.' }, { status: 409 })
    await db.batch([
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?').bind(full_name.trim(), account.user.id),
      db.prepare(`UPDATE organizations SET name = ?, slug = ?, description = ?, contact_email = ?, phone = ?, brand_color = ? WHERE id = ?`)
        .bind(name.trim(), slug, description.trim(), contact_email.trim(), phone.trim(), brand_color, account.organization.id),
    ])
    return Response.json(await getAccount(db, account.user.id))
  } catch (error) {
    if (String(error).includes('UNIQUE constraint')) return Response.json({ error: 'Este link já está em uso.' }, { status: 409 })
    console.error('Erro no perfil:', error)
    return Response.json({ error: 'Não foi possível guardar o perfil.' }, { status: 500 })
  }
}
