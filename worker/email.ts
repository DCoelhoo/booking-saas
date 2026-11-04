import type { D1Database, SendEmail } from '@cloudflare/workers-types'

export interface EmailEnv {
  booking_saas_db: D1Database
  EMAIL?: Pick<SendEmail, 'send'>
  EMAIL_MODE?: string
  EMAIL_FROM?: string
  APP_URL?: string
}
export type EmailPayload = { to: string; subject: string; text: string }

export function localPreview(request: Request, env: EmailEnv): boolean {
  return env.EMAIL_MODE === 'preview' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
}
export function configuredEmail(request: Request, env: EmailEnv): boolean {
  if (localPreview(request, env)) return true
  if (env.EMAIL_MODE !== 'live' || !env.EMAIL || !env.EMAIL_FROM || !env.APP_URL) return false
  try { return new URL(env.APP_URL).protocol === 'https:' } catch { return false }
}
export function appUrl(env: EmailEnv): string {
  const url = new URL(env.APP_URL || 'http://localhost:5173')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Invalid APP_URL')
  }
  return url.origin
}

export function emailStatement(db: D1Database, organizationId: string, kind: string, payload: EmailPayload, expiresAt: number | null = null, preview = false) {
  return db.prepare('INSERT INTO email_outbox (id, organization_id, kind, payload, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), organizationId, kind, JSON.stringify(payload), expiresAt, preview ? 'preview' : 'pending')
}

export async function flushEmailOutbox(env: EmailEnv): Promise<void> {
  const db = env.booking_saas_db
  const now = Date.now()
  await db.prepare(`UPDATE email_outbox SET status = 'expired', payload = NULL
    WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('pending', 'sending', 'preview', 'failed')`).bind(now).run()
  await db.prepare('DELETE FROM password_change_tokens WHERE expires_at <= ?').bind(now).run()
  await db.prepare(`UPDATE email_outbox SET status = 'failed', claim_token = NULL
    WHERE status = 'sending' AND locked_until <= ? AND attempts >= 8`).bind(now).run()
  await db.prepare(`DELETE FROM email_outbox WHERE status IN ('sent', 'failed', 'expired', 'preview')
    AND created_at < datetime('now', '-30 days')`).run()
  if (env.EMAIL_MODE !== 'live' || !env.EMAIL || !env.EMAIL_FROM) return
  const { results } = await db.prepare(`SELECT id FROM email_outbox
    WHERE ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND locked_until <= ?))
      AND attempts < 8 ORDER BY created_at, id LIMIT 20`).bind(now, now).all<{ id: string }>()
  for (const { id } of results) {
    const claim = crypto.randomUUID()
    const job = await db.prepare(`UPDATE email_outbox SET status = 'sending', locked_until = ?, claim_token = ?, attempts = attempts + 1
      WHERE id = ? AND attempts < 8
        AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND locked_until <= ?))
        AND (expires_at IS NULL OR expires_at > ?)
      RETURNING payload, attempts`).bind(Date.now() + 120_000, claim, id, Date.now(), Date.now(), Date.now())
      .first<{ payload: string; attempts: number }>()
    if (!job) continue
    try {
      const payload: EmailPayload = JSON.parse(job.payload)
      await env.EMAIL.send({ from: env.EMAIL_FROM, ...payload })
      await db.prepare(`UPDATE email_outbox SET status = 'sent', payload = NULL, claim_token = NULL,
        sent_at = CURRENT_TIMESTAMP WHERE id = ? AND claim_token = ?`).bind(id, claim).run()
    } catch {
      // Never log message bodies or password links. The durable outbox retries failures.
      await db.prepare(`UPDATE email_outbox SET status = ?, next_attempt_at = ?, claim_token = NULL
        WHERE id = ? AND claim_token = ?`)
        .bind(job.attempts >= 8 ? 'failed' : 'pending', Date.now() + Math.min(3_600_000, 60_000 * 2 ** job.attempts), id, claim).run()
    }
  }
}

export async function previewEmails(request: Request, env: EmailEnv, organizationId: string): Promise<Response> {
  if (!localPreview(request, env)) return Response.json({ error: 'Endpoint não encontrado.' }, { status: 404 })
  const { results } = await env.booking_saas_db.prepare(`SELECT id, kind, payload, status, created_at FROM email_outbox
    WHERE organization_id = ? AND payload IS NOT NULL AND (expires_at IS NULL OR expires_at > ?)
      AND status IN ('pending', 'preview') ORDER BY created_at DESC, rowid DESC LIMIT 30`)
    .bind(organizationId, Date.now()).all<{ id: string; kind: string; payload: string; status: string; created_at: string }>()
  return Response.json({ messages: results.map(({ payload, ...item }) => ({ ...item, ...JSON.parse(payload) })) })
}
