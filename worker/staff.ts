import { randomBytes, createHash } from 'node:crypto'
import { jsonBody, rateLimit, validEmail, type Account } from './auth.ts'
import { appUrl, configuredEmail, localPreview, type EmailEnv } from './email.ts'
import { subscriptionRequired } from './subscriptions.ts'

export async function handleStaff(request: Request, env: EmailEnv, account: Account): Promise<Response | null> {
  const url = new URL(request.url), match = url.pathname.match(/^\/api\/staff\/([^/]+)$/)
  if (url.pathname !== '/api/staff' && !match) return null
  const db = env.booking_saas_db, org = account.organization.id
  if (request.method === 'GET' && !match) {
    const { results } = await db.prepare(`SELECT m.id,m.name,m.is_active,CASE WHEN m.photo_key != '' THEN '/api/staff-photos/' || m.photo_key || '.jpg' ELSE '' END AS photo_url,u.email, CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END AS has_access
      FROM staff_members m LEFT JOIN users u ON u.staff_id=m.id WHERE m.organization_id=? AND (?='owner' OR m.id=?) ORDER BY m.created_at,m.id`)
      .bind(org,account.user.role,account.user.staff_id).all()
    return Response.json({ staff: results, limit: 10 })
  }
  if (account.user.role !== 'owner') return Response.json({ error: 'Apenas o dono pode gerir colaboradores.' }, { status: 403 })
  if (!account.subscription.can_manage) return subscriptionRequired()
  const body = await jsonBody(request)
  if (!body) return Response.json({ error: 'Dados inválidos.' }, { status: 400 })
  if (match && request.method === 'PATCH') {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length>100 || ![0,1].includes(body.is_active as number)) return Response.json({ error: 'Nome ou estado inválidos.' }, { status: 400 })
    const [updated] = await db.batch([
      db.prepare('UPDATE staff_members SET name=?,is_active=? WHERE id=? AND organization_id=? RETURNING id').bind(body.name.trim(),body.is_active,match[1],org),
      db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT u.id FROM users u JOIN staff_members m ON m.id=u.staff_id WHERE m.id=? AND m.organization_id=? AND m.is_active=0 AND u.role='staff')`).bind(match[1],org),
      db.prepare(`DELETE FROM calendar_subscriptions WHERE user_id IN (SELECT u.id FROM users u JOIN staff_members m ON m.id=u.staff_id WHERE m.id=? AND m.organization_id=? AND m.is_active=0 AND u.role='staff')`).bind(match[1],org),
      db.prepare(`DELETE FROM password_change_tokens WHERE user_id IN (SELECT u.id FROM users u JOIN staff_members m ON m.id=u.staff_id WHERE m.id=? AND m.organization_id=? AND m.is_active=0 AND u.role='staff')`).bind(match[1],org),
      db.prepare('DELETE FROM staff_invitations WHERE staff_id IN (SELECT id FROM staff_members WHERE id=? AND organization_id=? AND is_active=0)').bind(match[1],org),
    ])
    return updated.results.length ? Response.json(updated.results[0]) : Response.json({ error: 'Colaborador não encontrado.' }, { status:404 })
  }
  if (request.method !== 'POST') return Response.json({ error: 'Método não permitido.' }, { status:405 })
  if (!await rateLimit(db,`staff-invite:${account.user.id}`,20)) return Response.json({ error: 'Demasiados convites. Tenta novamente mais tarde.' },{status:429})
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!validEmail(email) || (!match && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length>100))) return Response.json({ error: 'Indica nome e email válidos.' }, { status:400 })
  if (!configuredEmail(request,env)) return Response.json({ error: 'Configura o envio de emails para convidar colaboradores.' }, { status:503 })
  if (await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) return Response.json({ error: 'Este email já está associado a uma conta.' }, { status:409 })
  const id=match?.[1] || crypto.randomUUID(), token=randomBytes(32).toString('base64url'), hash=createHash('sha256').update(token).digest('hex'), expires=Date.now()+7*86400000
  const member=match ? await db.prepare('SELECT id FROM staff_members WHERE id=? AND organization_id=? AND is_active=1').bind(id,org).first() : null
  if (match && !member) return Response.json({ error: 'Colaborador não encontrado ou inativo.' }, { status:404 })
  const insert = db.prepare(`INSERT INTO staff_members(id,organization_id,name) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM staff_members WHERE organization_id=?)<5 RETURNING id`)
    .bind(id,org,typeof body.name === 'string' ? body.name.trim() : '',org)
  try {
    const results=await db.batch([
      ...(match ? [] : [insert]),
      db.prepare(`INSERT INTO staff_invitations(staff_id,token_hash,email,expires_at) SELECT id,?,?,? FROM staff_members WHERE id=? AND organization_id=?
        AND NOT EXISTS(SELECT 1 FROM users WHERE staff_id=staff_members.id) ON CONFLICT(staff_id) DO UPDATE SET token_hash=excluded.token_hash,email=excluded.email,expires_at=excluded.expires_at RETURNING staff_id`)
        .bind(hash,email,expires,id,org),
      db.prepare(`INSERT INTO email_outbox(id,organization_id,kind,payload,status,expires_at) SELECT ?,?,'staff_invitation',?,?,? WHERE EXISTS(SELECT 1 FROM staff_invitations WHERE staff_id=? AND token_hash=?)`)
        .bind(crypto.randomUUID(),org,JSON.stringify({ to:email,subject:`Convite para ${account.organization.name}`,text:`Foste convidado para gerir a tua agenda em ${account.organization.name}.\n\n${appUrl(env)}/#staff-invitation=${token}\n\nEscolhe a tua palavra-passe. O convite é válido por 7 dias e só pode ser utilizado uma vez.` }),localPreview(request,env)?'preview':'pending',expires,id,hash),
    ])
    if (!(match ? results[0] : results[1]).results.length) return Response.json({ error: 'Limite de 5 colaboradores atingido ou colaborador já tem acesso.' }, { status:409 })
    return Response.json({ id, message:'Convite preparado. O colaborador deve aceitar o link recebido por email.' },{status:match?200:201})
  } catch { return Response.json({ error:'Não foi possível criar o convite. Verifica se o email já tem um convite pendente.' },{status:409}) }
}
