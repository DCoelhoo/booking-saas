import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo, demoCookie } from './account-fixture.mjs'
import { queueBookingReminders } from '../worker/reminders.ts'
import { flushEmailOutbox } from '../worker/email.ts'
import { businessNow, businessTimestamp } from '../worker/businessTime.ts'

async function setup(run) {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-reminders-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js', compatibilityDate: '2026-10-19',
    d1Databases: { booking_saas_db: 'recovery-reminders' }, bindings: { EMAIL_MODE: 'preview', APP_URL: 'http://localhost' } })
  options.resourcePersistencePath = directory
  const runtime = new Miniflare(options)
  const request = (path, method = 'GET', body, headers = {}, host = 'localhost') => runtime.dispatchFetch(`http://${host}/api/${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  try {
    const db = await runtime.getD1Database('booking_saas_db')
    for (const sql of (await readFile('migrations/0001_initial_schema.sql', 'utf8')).split(';').filter((s) => s.trim())) await db.prepare(sql).run()
    await db.prepare("INSERT INTO organizations(id,name,slug) VALUES ('org-demo','Demo','demo')").run()
    await authenticateDemo(db)
    await run({ db, request, runtime })
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
}

test('password recovery hides account existence, expires old links and consumes the latest token once', async () => setup(async ({ db, request }) => {
  const credentials = { email: 'recover@example.test', password: 'password antiga de teste', full_name: 'Conta', business_name: 'Recuperação', slug: 'recuperacao' }
  const registered = await request('auth/register', 'POST', credentials)
  assert.equal(registered.status, 201)
  const cookie = registered.headers.get('Set-Cookie').split(';')[0]
  const { user } = await registered.json()
  const reset = (email = credentials.email, headers) => request('auth/password/reset', 'POST', { email }, headers)
  assert.equal((await reset('invalido')).status, 400)
  assert.equal((await request('auth/password/reset', 'POST', { email: credentials.email }, {}, 'production.example')).status, 503)
  const missing = await reset('missing@example.test')
  const known = await reset(' RECOVER@example.test ')
  assert.equal(known.status, 202)
  assert.equal(missing.status, known.status)
  assert.deepEqual(await missing.json(), await known.json())
  assert.equal((await request('auth/session', 'GET', undefined, { Cookie: cookie })).status, 200, 'request alone must not revoke sessions')
  const readToken = async () => {
    const row = await db.prepare("SELECT payload FROM email_outbox WHERE kind='password_reset_request' AND status='preview' AND payload IS NOT NULL ORDER BY rowid DESC LIMIT 1").first()
    return JSON.parse(row.payload).text.match(/reset-password=([\w-]+)/)[1]
  }
  const token1 = await readToken()
  const stored = await db.prepare('SELECT token_hash FROM password_change_tokens WHERE user_id=?').bind(user.id).first()
  assert.notEqual(stored.token_hash, token1)
  assert.equal(token1.length, 43)
  const confirm = (token) => request('auth/password/confirm', 'POST', { token, new_password: 'nova password muito segura' })
  await reset()
  const token2 = await readToken()
  assert.notEqual(token1, token2)
  assert.equal((await confirm(token1)).status, 400)
  await db.prepare('UPDATE password_change_tokens SET expires_at=0 WHERE user_id=?').bind(user.id).run()
  assert.equal((await confirm(token2)).status, 400)
  await reset()
  const latest = await readToken()
  const race = await Promise.all([confirm(latest), confirm(latest)])
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 400])
  assert.equal((await confirm(latest)).status, 400)
  assert.equal((await request('auth/session', 'GET', undefined, { Cookie: cookie })).status, 401)
  assert.equal((await request('auth/login', 'POST', credentials)).status, 401)
  assert.equal((await request('auth/login', 'POST', { ...credentials, password: 'nova password muito segura' })).status, 200)
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE kind='password_changed'").first()).n, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM password_change_tokens WHERE user_id=?').bind(user.id).first()).n, 0)
  assert.equal((await reset()).status, 202, 'email cap must remain generic')
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE kind='password_reset_request' AND payload IS NOT NULL").first()).n, 0)
  assert.equal((await request('email-previews')).status, 401)
  for (let i = 0; i < 30; i++) await reset(`unknown-${i}@example.test`, { 'CF-Connecting-IP': '192.0.2.222' })
  assert.equal((await reset('unknown@example.test', { 'CF-Connecting-IP': '192.0.2.222' })).status, 429)
}))

test('reminders follow Lisbon time, deduplicate jobs and never deliver canceled or stale booking versions', async () => setup(async ({ db, request }) => {
  const now = Date.now()
  const hour = 3600000
  const start = businessNow(new Date(now + 20 * hour)), end = businessNow(new Date(now + 20.5 * hour))
  const old = new Date(now - 48 * hour).toISOString().replace('T', ' ').slice(0, 19)
  await db.prepare("INSERT INTO services(id,organization_id,name,duration_minutes,price_cents) VALUES ('service','org-demo','Consulta',30,1000)").run()
  async function seed(id, extra = {}) {
    const value = { start, end, created: old, email: 'client@example.test', status: 'confirmed', ...extra }
    await db.prepare(`INSERT INTO bookings(id,organization_id,service_id,customer_name,customer_email,start_at,end_at,created_at,status)
      VALUES (?,'org-demo','service','Cliente',?,?,?,?,?)`).bind(id, value.email, value.start, value.end, value.created, value.status).run()
  }
  await seed('due')
  await seed('canceled', { status: 'canceled' })
  await seed('recent', { created: new Date(now).toISOString().replace('T', ' ').slice(0, 19) })
  await seed('no-email', { email: '' })
  await seed('later', { start: businessNow(new Date(now + 48 * hour)), end: businessNow(new Date(now + 48.5 * hour)) })
  const preview = { booking_saas_db: db, EMAIL_MODE: 'preview' }
  await Promise.all([queueBookingReminders(preview, now), queueBookingReminders(preview, now)])
  const jobs = (await db.prepare("SELECT * FROM email_outbox WHERE kind='booking_reminder'").all()).results
  assert.equal(jobs.filter((j) => j.status === 'preview').length, 1)
  assert.equal(jobs.find((j) => j.booking_id === 'recent').status, 'expired')
  const due = jobs.find((j) => j.booking_id === 'due')
  assert.match(JSON.parse(due.payload).text, new RegExp(start.slice(11, 16)))
  assert.equal(due.expires_at, businessTimestamp(start))
  assert.equal((await request('reminders/preview-run', 'POST', {})).status, 401)
  assert.equal((await request('reminders/preview-run', 'POST', {}, { Cookie: demoCookie })).status, 200)
  const localMessages = await request('email-previews', 'GET', undefined, { Cookie: demoCookie })
  assert.equal(localMessages.status, 200)
  assert.equal((await localMessages.json()).messages.filter((m) => m.kind === 'booking_reminder').length, 1)
  assert.equal((await request('reminders/preview-run', 'POST', {}, { Cookie: demoCookie }, 'production.example')).status, 404)
  const canceled = await request('bookings/due', 'PATCH', { status: 'canceled', version: 1 }, { Cookie: demoCookie })
  assert.equal(canceled.status, 200)
  assert.equal((await db.prepare('SELECT status,payload FROM email_outbox WHERE id=?').bind(due.id).first()).status, 'expired')
  // Delivery independently revalidates snapshots, including changes made outside the normal UI.
  await seed('stale')
  await seed('send')
  const sent = []
  const live = { booking_saas_db: db, EMAIL_MODE: 'live', EMAIL_FROM: 'sender@example.test', EMAIL: { send: async (m) => { sent.push(m); return { messageId: 'fake' } } } }
  await queueBookingReminders(live, now)
  await db.prepare("UPDATE bookings SET version=version+1,start_at=?,end_at=? WHERE id='stale'").bind(businessNow(new Date(now + 72 * hour)), businessNow(new Date(now + 72.5 * hour))).run()
  // Force one provider failure; retry must still check the booking is current.
  live.EMAIL.send = async () => { throw Error('Fake provider unavailable') }
  await flushEmailOutbox(live)
  assert.equal((await db.prepare("SELECT status FROM email_outbox WHERE id='booking-reminder:send:1'").first()).status, 'pending')
  await db.prepare("UPDATE bookings SET status='canceled' WHERE id='send'").run()
  await db.prepare("UPDATE email_outbox SET next_attempt_at=0 WHERE kind='booking_reminder'").run()
  live.EMAIL.send = async (m) => { sent.push(m); return { messageId: 'fake' } }
  await flushEmailOutbox(live)
  assert.equal(sent.filter((m) => m.subject.startsWith('Lembrete')).length, 0)
  assert.equal((await db.prepare("SELECT status FROM email_outbox WHERE id='booking-reminder:stale:1'").first()).status, 'expired')
  // A new booking version gets its own reminder for the new time; repeated cron runs do not duplicate it.
  const later = businessTimestamp((await db.prepare("SELECT start_at FROM bookings WHERE id='stale'").first()).start_at)
  await db.prepare("INSERT INTO booking_events(id,booking_id,organization_id,actor,kind,previous_start_at,previous_end_at,start_at,end_at,status,version,created_at) SELECT 'move','stale','org-demo','customer','reschedule',?, ?,start_at,end_at,status,version,? FROM bookings WHERE id='stale'")
    .bind(start, end, old).run()
  await Promise.all([queueBookingReminders(live, later - 24 * hour), queueBookingReminders(live, later - 24 * hour)])
  await Promise.all([flushEmailOutbox(live), flushEmailOutbox(live)])
  assert.equal(sent.filter((m) => m.subject.startsWith('Lembrete') && m.text.includes('Referência: stale')).length, 1)
  assert.equal((await db.prepare("SELECT status FROM email_outbox WHERE id='booking-reminder:stale:2'").first()).status, 'sent')
  assert.equal(businessTimestamp('2027-03-28T10:00:00'), Date.parse('2027-03-28T09:00:00Z'))
  assert.equal(businessTimestamp('2027-03-27T10:00:00'), Date.parse('2027-03-27T10:00:00Z'))
  assert.equal(businessTimestamp('2027-03-28T01:30:00'), null)
}))
