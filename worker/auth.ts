import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { D1Database } from '@cloudflare/workers-types'

export type Account = {
  user: { id: string; email: string; full_name: string }
  organization: {
    id: string; name: string; slug: string; description: string; contact_email: string
    phone: string; brand_color: string; logo_url: string
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
  const user = await db.prepare('SELECT id, email, full_name, organization_id FROM users WHERE id = ?')
    .bind(userId).first<Account['user'] & { organization_id: string }>()
  if (!user) return null
  const organization = await db.prepare(`SELECT id, name, slug, description, contact_email, phone, brand_color, logo_url
    FROM organizations WHERE id = ?`).bind(user.organization_id).first<Account['organization']>()
  return organization ? { user: { id: user.id, email: user.email, full_name: user.full_name }, organization } : null
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

async function rateLimit(db: D1Database, key: string, limit: number): Promise<boolean> {
  const now = Date.now()
  const row = await db.prepare(`INSERT INTO auth_rate_limits (key, hits, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN reset_at <= ? THEN 1 ELSE hits + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
    RETURNING hits`).bind(key, now + 15 * 60 * 1000, now, now).first<{ hits: number }>()
  return row!.hits <= limit
}

export async function handleAuth(request: Request, db: D1Database): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith('/api/auth/')) return null
  try {
    if (path === '/api/auth/session' && request.method === 'GET') {
      const account = await authenticate(request, db)
      return account ? Response.json(account) : Response.json({ error: 'Inicia sessão para continuar.' }, { status: 401 })
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const token = cookieToken(request)
      if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(digest(token)).run()
      return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(request, '', 0) } })
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
        try {
          await db.batch([
            db.prepare('INSERT INTO organizations (id, name, slug, contact_email) VALUES (?, ?, ?, ?)')
              .bind(orgId, business_name.trim(), slug, email),
            db.prepare('INSERT INTO users (id, organization_id, email, full_name, password_hash) VALUES (?, ?, ?, ?, ?)')
              .bind(userId, orgId, email, full_name.trim(), hashed),
            session.statement,
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
      if (!body || !validPassword(body.current_password) || !validPassword(body.new_password)) {
        return Response.json({ error: 'A palavra-passe deve ter entre 12 e 128 caracteres.' }, { status: 400 })
      }
      const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(account.user.id).first<{ password_hash: string }>()
      if (!user || !await verifyPassword(body.current_password, user.password_hash)) {
        return Response.json({ error: 'A palavra-passe atual está incorreta.' }, { status: 400 })
      }
      const session = newSession(db, account.user.id)
      await db.batch([
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await passwordHash(body.new_password), account.user.id),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(account.user.id),
        session.statement,
      ])
      return Response.json({ success: true }, { headers: { 'Set-Cookie': cookie(request, session.token) } })
    }
    return Response.json({ error: 'Endpoint não encontrado.' }, { status: 404 })
  } catch (error) {
    console.error('Erro de autenticação:', error)
    return Response.json({ error: 'Não foi possível concluir a operação. Tenta novamente.' }, { status: 500 })
  }
}
