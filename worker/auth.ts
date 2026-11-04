import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { D1Database } from '@cloudflare/workers-types'
import { subscriptionAccess, type SubscriptionFields } from './subscriptions.ts'
import { appUrl, configuredEmail, emailStatement, localPreview, type EmailEnv } from './email.ts'

export type Account = {
  subscription: ReturnType<typeof subscriptionAccess>
  user: { id: string; email: string; full_name: string; role: 'owner' | 'staff'; staff_id: string | null; photo_url: string }
  organization: {
    id: string; name: string; slug: string; description: string; contact_email: string
    phone: string; brand_color: string; logo_url: string; cover_url: string; profile_photo_url: string
  }
}

const sessionSeconds = 7 * 24 * 60 * 60
const reservedSlugs = new Set(['api', 'admin', 'auth', 'login', 'logout', 'register', 'dashboard',
  'assets', 'settings', 'definicoes', 'servicos', 'agenda', 'account', 'conta', 'www', 'help', 'support'])
export function validSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 3 && value.length <= 63 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !reservedSlugs.has(value)
}
export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
const validPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 12 && value.length <= 128

export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text()
  if (text.length > 16_384) return null
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : null
  } catch { return null }
}

function derive(password: string, salt: string): Promise<Buffer> {
  // OWASP scrypt configuration: N=2^14, r=8, p=5, below the Worker memory limit.
  return new Promise((resolve, reject) => scrypt(password, salt, 32,
    { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)))
}
async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:16384:8:5:${salt}:${(await derive(password, salt)).toString('hex')}`
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, , , , salt, hash] = encoded.split(':')
  const derived = await derive(password, salt)
  const expected = Buffer.from(hash, 'hex')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
function cookieToken(request: Request): string | null {
  const prefix = new URL(request.url).protocol === 'https:' ? '__Host-booking_session=' : 'booking_session='
  const value = request.headers.get('Cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length)
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
}
function cookie(request: Request, token: string, maxAge = sessionSeconds): string {
  const secure = new URL(request.url).protocol === 'https:'
  return `${secure ? '__Host-booking_session' : 'booking_session'}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}
function newSession(db: D1Database, userId: string) {
  const token = randomBytes(32).toString('base64url')
  return { token, statement: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(digest(token), userId, Date.now() + sessionSeconds * 1000) }
}
export async function getAccount(db: D1Database, userId: string): Promise<Account | null> {
  const user = await db.prepare(`SELECT id, email, full_name, organization_id, role, staff_id, COALESCE((SELECT CASE WHEN m.photo_key != '' THEN '/api/staff-photos/' || m.photo_key || '.jpg' ELSE '' END FROM staff_members m WHERE m.id=users.staff_id),'') AS photo_url FROM users WHERE id = ?
    AND (role = 'owner' OR EXISTS (SELECT 1 FROM staff_members m WHERE m.id = users.staff_id AND m.organization_id = users.organization_id AND m.is_active = 1))`)
    .bind(userId).first<Account['user'] & { organization_id: string }>()
  if (!user) return null
  const row = await db.prepare(`SELECT id, name, slug, description, contact_email, phone, brand_color, logo_url,
    CASE WHEN cover_photo_key != '' THEN '/api/business-photos/' || cover_photo_key || '.jpg' ELSE '' END AS cover_url,
    CASE WHEN profile_photo_key != '' THEN '/api/business-photos/' || profile_photo_key || '.jpg' ELSE '' END AS profile_photo_url,
    trial_started_at, trial_ends_at, subscription_status, paid_until
    FROM organizations WHERE id = ?`).bind(user.organization_id).first<Account['organization'] & SubscriptionFields>()
  if (!row) return null
  const { trial_started_at, trial_ends_at, subscription_status, paid_until, ...organization } = row
  return {
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, staff_id: user.staff_id, photo_url: user.photo_url }, organization,
    subscription: subscriptionAccess({ trial_started_at, trial_ends_at, subscription_status, paid_until }),
  }
}
export async function authenticate(request: Request, db: D1Database): Promise<Account | null> {
  const token = cookieToken(request)
  if (!token) return null
  const session = await db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(digest(token), Date.now()).first<{ user_id: string }>()
  return session ? getAccount(db, session.user_id) : null
}

export function checkMutation(request: Request): Response | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null
  const origin = request.headers.get('Origin')
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return Response.json({ error: 'Origem do pedido não permitida.' }, { status: 403 })
  }
  if (request.method !== 'DELETE' && request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return Response.json({ error: 'Envia os dados em JSON.' }, { status: 415 })
  }
  return null
}

export async function rateLimit(db: D1Database, key: string, limit: number): Promise<boolean> {
  const now = Date.now()
  const row = await db.prepare(`INSERT INTO auth_rate_limits (key, hits, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN reset_at <= ? THEN 1 ELSE hits + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
    RETURNING hits`).bind(key, now + 15 * 60 * 1000, now, now).first<{ hits: number }>()
  return row!.hits <= limit
}

export async function handleAuth(request: Request, db: D1Database, env: EmailEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith('/api/auth/')) return null
  try {
    if (path === '/api/auth/invitation/accept' && request.method === 'POST') {
      if (!await rateLimit(db, `invite-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, 20)) return Response.json({ error: 'Demasiadas tentativas.' }, { status: 429 })
      const body = await jsonBody(request)
      if (!body || typeof body.token !== 'string' || !/^[\w-]{43}$/.test(body.token) || !validPassword(body.new_password)) return Response.json({ error: 'Link ou palavra-passe inválidos.' }, { status: 400 })
      const hashed = await passwordHash(body.new_password)
      const id = crypto.randomUUID()
      const [created] = await db.batch([
        db.prepare(`INSERT INTO users(id,organization_id,email,full_name,password_hash,role,staff_id)
          SELECT ?,m.organization_id,i.email,m.name,?,'staff',m.id FROM staff_invitations i JOIN staff_members m ON m.id=i.staff_id
          WHERE i.token_hash=? AND i.expires_at>? AND m.is_active=1
            AND NOT EXISTS(SELECT 1 FROM users u WHERE u.email=i.email OR u.staff_id=m.id)
          RETURNING id`).bind(id,hashed,digest(body.token),Date.now()),
        db.prepare('DELETE FROM staff_invitations WHERE token_hash=? AND EXISTS(SELECT 1 FROM users WHERE id=?)').bind(digest(body.token),id),
      ])
      return created.results.length ? Response.json({ message: 'Acesso criado. Inicia sessão com o teu email e palavra-passe.' }) : Response.json({ error: 'O convite expirou, foi utilizado ou já existe uma conta com este email.' }, { status: 400 })
    }
    if (path === '/api/auth/session' && request.method === 'GET') {
      const account = await authenticate(request, db)
      return account ? Response.json(account) : Response.json({ error: 'Inicia sessão para continuar.' }, { status: 401 })
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const token = cookieToken(request)
      if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(digest(token)).run()
      return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(request, '', 0) } })
    }
    if (path === '/api/auth/password/reset' && request.method === 'POST') {
      if (!await rateLimit(db, `reset-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, 30)) {
        return Response.json({ error: 'Demasiados pedidos. Tenta novamente dentro de 15 minutos.' }, { status: 429, headers: { 'Retry-After': '900' } })
      }
      const body = await jsonBody(request)
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!validEmail(email)) return Response.json({ error: 'Indica um email válido.' }, { status: 400 })
      if (!configuredEmail(request, env)) return Response.json({ error: 'A recuperação por email ainda não está disponível. Tenta novamente mais tarde.' }, { status: 503 })
      const response = () => Response.json({ message: 'Se existir uma conta com este email, receberás um link para recuperar o acesso. O link é válido por 30 minutos.' }, { status: 202 })
      // Apply the same limit and response to existing and unknown addresses.
      if (!await rateLimit(db, `reset-email:${digest(email)}`, 3)) return response()
      const token = randomBytes(32).toString('base64url')
      const user = await db.prepare('SELECT id, organization_id, password_hash FROM users WHERE email = ?')
        .bind(email).first<{ id: string; organization_id: string; password_hash: string }>()
      if (!user) return response()
      const expiresAt = Date.now() + 30 * 60 * 1000
      await db.batch([
        db.prepare(`INSERT INTO password_change_tokens (token_hash, user_id, password_hash_at_request, expires_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash,
          password_hash_at_request = excluded.password_hash_at_request, expires_at = excluded.expires_at,
          created_at = CURRENT_TIMESTAMP`).bind(digest(token), user.id, user.password_hash, expiresAt),
        db.prepare(`UPDATE email_outbox SET status = 'expired', payload = NULL WHERE organization_id = ?
          AND kind IN ('password_request', 'password_reset_request') AND status IN ('pending', 'preview') AND json_extract(payload,'$.to')=?`).bind(user.organization_id,email),
        emailStatement(db, user.organization_id, 'password_reset_request', { to: email, subject: 'Recupera o acesso à tua conta',
          text: `Foi pedida a recuperação de acesso à tua conta Booking SaaS.\n\nEscolhe uma nova palavra-passe neste link:\n\n${appUrl(env)}/#reset-password=${token}\n\nO link é válido por 30 minutos e só pode ser usado uma vez. A palavra-passe atual e as sessões mantêm-se até confirmares. Se não fizeste este pedido, ignora esta mensagem.`,
        }, expiresAt, localPreview(request, env)),
      ])
      return response()
    }
    if ((path === '/api/auth/register' || path === '/api/auth/login') && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'local'
      if (!await rateLimit(db, `ip:${ip}`, 30)) {
        return Response.json({ error: 'Demasiadas tentativas. Tenta novamente dentro de 15 minutos.' }, { status: 429, headers: { 'Retry-After': '900' } })
      }
      const body = await jsonBody(request)
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!body || !validEmail(email) || !validPassword(body.password)) {
        return Response.json({ error: 'Indica um email válido e uma palavra-passe entre 12 e 128 caracteres.' }, { status: 400 })
      }
      if (!await rateLimit(db, `email:${digest(email)}`, 10)) {
        return Response.json({ error: 'Demasiadas tentativas. Tenta novamente dentro de 15 minutos.' }, { status: 429, headers: { 'Retry-After': '900' } })
      }
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
        db.prepare('DELETE FROM auth_rate_limits WHERE reset_at <= ?').bind(Date.now()),
      ])
      let userId: string
      if (path === '/api/auth/register') {
        const { full_name, business_name, slug } = body
        if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 100 ||
            typeof business_name !== 'string' || !business_name.trim() || business_name.trim().length > 100 || !validSlug(slug)) {
          return Response.json({ error: 'Indica os nomes e um link de 3 a 63 letras minúsculas, números ou hífenes. Evita nomes reservados.' }, { status: 400 })
        }
        const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
        if (existing) return Response.json({ error: 'Não foi possível criar a conta com estes dados. Se já tens conta, inicia sessão.' }, { status: 409 })
        const occupied = await db.prepare('SELECT id FROM organizations WHERE slug = ?').bind(slug).first()
        if (occupied) return Response.json({ error: 'Este link já está em uso. Escolhe outro.' }, { status: 409 })
        userId = crypto.randomUUID()
        const orgId = crypto.randomUUID()
        const hashed = await passwordHash(body.password)
        const session = newSession(db, userId)
        const trialStartedAt = Date.now()
        try {
          await db.batch([
            db.prepare('INSERT INTO organizations (id, name, slug, contact_email, trial_started_at, trial_ends_at) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(orgId, business_name.trim(), slug, email, trialStartedAt, trialStartedAt + 14 * 86_400_000),
            db.prepare('INSERT INTO users (id, organization_id, email, full_name, password_hash) VALUES (?, ?, ?, ?, ?)')
              .bind(userId, orgId, email, full_name.trim(), hashed),
            session.statement,
            emailStatement(db, orgId, 'welcome', { to: email, subject: 'Bem-vindo ao Booking SaaS',
              text: `Olá, ${full_name.trim()}!\n\nA conta do negócio ${business_name.trim()} foi criada. Tens 14 dias de teste, sem cartão e sem cobranças automáticas.\n\nJá podes configurar os serviços e horários na aplicação.\n\nSe não criaste esta conta, ignora esta mensagem.` }, null, localPreview(request, env)),
          ])
        } catch (error) {
          if (String(error).includes('UNIQUE constraint')) {
            return Response.json({ error: 'O email ou o link já está em uso. Revê os dados.' }, { status: 409 })
          }
          throw error
        }
        return Response.json(await getAccount(db, userId), { status: 201, headers: { 'Set-Cookie': cookie(request, session.token) } })
      }
      const user = await db.prepare('SELECT id, password_hash FROM users WHERE email = ?')
        .bind(email).first<{ id: string; password_hash: string }>()
      // Use the same expensive derivation for unknown emails to reduce account enumeration.
      const dummy = 'scrypt:16384:8:5:00000000000000000000000000000000:' + '0'.repeat(64)
      const valid = await verifyPassword(body.password, user?.password_hash || dummy)
      if (!user || !valid) return Response.json({ error: 'Email ou palavra-passe incorretos.' }, { status: 401 })
      if (!await getAccount(db, user.id)) return Response.json({ error: 'Email ou palavra-passe incorretos.' }, { status: 401 })
      userId = user.id
      const session = newSession(db, userId)
      const oldToken = cookieToken(request)
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(oldToken ? digest(oldToken) : ''),
        session.statement,
      ])
      return Response.json(await getAccount(db, userId), { headers: { 'Set-Cookie': cookie(request, session.token) } })
    }
    if (path === '/api/auth/password' && request.method === 'POST') {
      const account = await authenticate(request, db)
      if (!account) return Response.json({ error: 'Inicia sessão para continuar.' }, { status: 401 })
      if (!await rateLimit(db, `password:${account.user.id}`, 10)) {
        return Response.json({ error: 'Demasiadas tentativas. Tenta novamente mais tarde.' }, { status: 429 })
      }
      const body = await jsonBody(request)
      if (!body || !validPassword(body.current_password)) {
        return Response.json({ error: 'Indica a tua palavra-passe atual.' }, { status: 400 })
      }
      const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(account.user.id).first<{ password_hash: string }>()
      if (!user || !await verifyPassword(body.current_password, user.password_hash)) {
        return Response.json({ error: 'A palavra-passe atual está incorreta.' }, { status: 400 })
      }
      if (!configuredEmail(request, env)) {
        return Response.json({ error: 'O envio de emails ainda não está disponível. Tenta novamente mais tarde.' }, { status: 503 })
      }
      const token = randomBytes(32).toString('base64url')
      const expiresAt = Date.now() + 30 * 60 * 1000
      const link = `${appUrl(env)}/#change-password=${token}`
      await db.batch([
        db.prepare(`INSERT INTO password_change_tokens (token_hash, user_id, password_hash_at_request, expires_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash,
          password_hash_at_request = excluded.password_hash_at_request, expires_at = excluded.expires_at,
          created_at = CURRENT_TIMESTAMP`).bind(digest(token), account.user.id, user.password_hash, expiresAt),
        db.prepare(`UPDATE email_outbox SET status = 'expired', payload = NULL WHERE organization_id = ?
          AND kind IN ('password_request', 'password_reset_request') AND status IN ('pending', 'preview') AND json_extract(payload,'$.to')=?`).bind(account.organization.id,account.user.email),
        emailStatement(db, account.organization.id, 'password_request', {
          to: account.user.email, subject: 'Confirma a alteração da palavra-passe',
          text: `Olá, ${account.user.full_name}.\n\nFoi pedida uma alteração da palavra-passe da tua conta. Abre este link para escolher uma nova palavra-passe:\n\n${link}\n\nO link é válido durante 30 minutos e só pode ser usado uma vez. A tua palavra-passe mantém-se até confirmares. Se não fizeste este pedido, ignora a mensagem.`,
        }, expiresAt, localPreview(request, env)),
      ])
      return Response.json({ message: localPreview(request, env)
        ? 'Pedido criado. Abre a pré-visualização de emails locais para continuar.'
        : 'Pedido registado. Consulta o teu email para escolher a nova palavra-passe.' }, { status: 202 })
    }
    if (path === '/api/auth/password/confirm' && request.method === 'POST') {
      if (!await rateLimit(db, `confirm-ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, 20)) {
        return Response.json({ error: 'Demasiadas tentativas. Tenta novamente mais tarde.' }, { status: 429 })
      }
      const body = await jsonBody(request)
      if (!body || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token) || !validPassword(body.new_password)) {
        return Response.json({ error: 'Link inválido ou palavra-passe fora dos 12 a 128 caracteres.' }, { status: 400 })
      }
      const tokenHash = digest(body.token)
      const pending = await db.prepare(`SELECT t.user_id, u.organization_id, u.email FROM password_change_tokens t
        JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.expires_at > ?
          AND t.password_hash_at_request = u.password_hash`).bind(tokenHash, Date.now())
        .first<{ user_id: string; organization_id: string; email: string }>()
      if (!pending) return Response.json({ error: 'O link expirou ou já foi utilizado. Pede um novo link na página de início de sessão ou nas Definições.' }, { status: 400 })
      const hashed = await passwordHash(body.new_password)
      const [updated] = await db.batch([
        db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND EXISTS (
          SELECT 1 FROM password_change_tokens t WHERE t.user_id = users.id AND t.token_hash = ?
            AND t.expires_at > ? AND t.password_hash_at_request = users.password_hash) RETURNING id`)
          .bind(hashed, pending.user_id, tokenHash, Date.now()),
        db.prepare(`INSERT INTO email_outbox (id, organization_id, kind, payload, status)
          SELECT ?, ?, 'password_changed', ?, ? WHERE changes() = 1`)
          .bind(crypto.randomUUID(), pending.organization_id, JSON.stringify({ to: pending.email,
            subject: 'A tua palavra-passe foi alterada',
            text: 'A palavra-passe da tua conta Booking SaaS foi alterada. Todas as sessões anteriores foram terminadas. Se não reconheces esta alteração, contacta o suporte da aplicação.',
          }), localPreview(request, env) ? 'preview' : 'pending'),
        db.prepare(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (
          SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`).bind(pending.user_id, pending.user_id, hashed),
        db.prepare(`DELETE FROM password_change_tokens WHERE user_id = ? AND EXISTS (
          SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`).bind(pending.user_id, pending.user_id, hashed),
        db.prepare(`UPDATE email_outbox SET status = 'expired', payload = NULL
          WHERE organization_id = ? AND kind IN ('password_request', 'password_reset_request') AND status IN ('pending', 'preview')
            AND json_extract(payload,'$.to')=? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`)
          .bind(pending.organization_id, pending.email, pending.user_id, hashed),
      ])
      if (!updated.results.length) return Response.json({ error: 'O link expirou ou já foi utilizado.' }, { status: 400 })
      return Response.json({ message: 'Palavra-passe alterada. Inicia sessão com a nova palavra-passe.' }, {
        headers: { 'Set-Cookie': cookie(request, '', 0) },
      })
    }
    return Response.json({ error: 'Endpoint não encontrado.' }, { status: 404 })
  } catch (error) {
    console.error('Erro de autenticação:', error)
    return Response.json({ error: 'Não foi possível concluir a operação. Tenta novamente.' }, { status: 500 })
  }
}
