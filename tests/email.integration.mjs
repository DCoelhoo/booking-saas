import { applySql } from './apply-sql.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { flushEmailOutbox } from '../worker/email.ts'

test('email events are isolated, password links expire and jobs survive delivery failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-email-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'email-integration' },
    bindings: { EMAIL_MODE: 'preview', APP_URL: 'http://localhost' } })
  options.resourcePersistencePath = directory
  const runtime = new Miniflare(options)
  const request = (path, method = 'GET', body, cookie = '', host = 'localhost') => runtime.dispatchFetch(`http://${host}/api/${path}`, {
    method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const credentials = { email: 'owner@example.test', password: 'uma frase para testar emails', full_name: 'Conta', business_name: 'Negócio', slug: 'teste-email' }
  const cookieOf = (response) => response.headers.get('Set-Cookie').split(';')[0]
  try {
    const db = await runtime.getD1Database('booking_saas_db')
    for (const file of ['0001_initial_schema.sql', '0002_accounts.sql', '0003_subscription_trials.sql', '0004_availability.sql', '0005_email_notifications.sql', '0006_booking_payment_settings.sql', '0007_public_bookings.sql', '0008_booking_lifecycle.sql', '0009_booking_reminders.sql', '0010_staff.sql', '0011_profile_photos.sql', '0012_calendar_subscriptions.sql']) {
      const sql = await readFile(`migrations/${file}`, 'utf8')
      await applySql(db,sql)
    }
    const registered = await request('auth/register', 'POST', credentials)
    assert.equal(registered.status, 201)
    const cookie = cookieOf(registered)
    const account = await registered.json()
    assert.equal((await request('email-previews')).status, 401)
    assert.equal((await request('email-previews', 'GET', undefined, cookie, 'production.example')).status, 404)
    let previews = (await (await request('email-previews', 'GET', undefined, cookie)).json()).messages
    assert.equal(previews.length, 1)
    assert.equal(previews[0].kind, 'welcome')
    assert.equal(previews[0].to, credentials.email)
    const second = await request('auth/register', 'POST', { ...credentials, email: 'other@example.test', slug: 'other-email' })
    const otherCookie = cookieOf(second)
    const otherPreviews = (await (await request('email-previews', 'GET', undefined, otherCookie)).json()).messages
    assert.equal(otherPreviews.length, 1)
    assert.equal(otherPreviews[0].to, 'other@example.test')
    const service = await (await request('services', 'POST', { name: 'Consulta', duration_minutes: 30, price_cents: 1000 }, cookie)).json()
    await request('profile', 'PATCH', { ...account.organization, full_name: account.user.full_name, contact_email: 'bookings@example.test' }, cookie)
    const bookingInput = { customer_name: 'Cliente', service_id: service.id, date: '2090-01-01', start_time: '10:00' }
    assert.equal((await request('bookings', 'POST', bookingInput, cookie)).status, 201)
    assert.equal((await request('bookings', 'POST', bookingInput, cookie)).status, 409)
    const jobs = await db.prepare("SELECT payload FROM email_outbox WHERE kind = 'booking_created'").all()
    assert.equal(jobs.results.length, 1)
    assert.equal(JSON.parse(jobs.results[0].payload).to, 'bookings@example.test')
    assert.match(JSON.parse(jobs.results[0].payload).text, /10:00–10:30/)
    const change = () => request('auth/password', 'POST', { current_password: credentials.password }, cookie)
    assert.equal((await change()).status, 202)
    previews = (await (await request('email-previews', 'GET', undefined, cookie)).json()).messages
    const firstToken = previews.find((m) => m.kind === 'password_request').text.match(/change-password=([A-Za-z0-9_-]+)/)[1]
    assert.equal((await change()).status, 202)
    assert.equal((await request('auth/password/confirm', 'POST', { token: firstToken, new_password: 'nova frase muito segura' })).status, 400)
    previews = (await (await request('email-previews', 'GET', undefined, cookie)).json()).messages
    const secondToken = previews.find((m) => m.kind === 'password_request').text.match(/change-password=([A-Za-z0-9_-]+)/)[1]
    await db.prepare('UPDATE password_change_tokens SET expires_at = 0').run()
    assert.equal((await request('auth/password/confirm', 'POST', { token: secondToken, new_password: 'nova frase muito segura' })).status, 400)
    assert.equal((await change()).status, 202)
    previews = (await (await request('email-previews', 'GET', undefined, cookie)).json()).messages
    const token = previews.find((m) => m.kind === 'password_request').text.match(/change-password=([A-Za-z0-9_-]+)/)[1]
    assert.equal((await request('auth/session', 'GET', undefined, cookie)).status, 200)
    assert.equal((await request('auth/password/confirm', 'POST', { token, new_password: 'nova frase muito segura' })).status, 200)
    assert.equal((await request('auth/password/confirm', 'POST', { token, new_password: 'nova frase muito segura' })).status, 400)
    assert.equal((await request('auth/session', 'GET', undefined, cookie)).status, 401)
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE kind = 'password_changed'").first()).count, 1)
    // Mock the native binding: no real email is sent by this test.
    const deliveryEnv = { booking_saas_db: db, EMAIL_MODE: 'live', EMAIL_FROM: 'sender@example.test',
      EMAIL: { send: async () => { throw new Error('Provider unavailable') } } }
    await db.prepare("INSERT INTO email_outbox (id, organization_id, kind, payload) VALUES ('retry-job', ?, 'welcome', ?)")
      .bind(account.organization.id, JSON.stringify({ to: credentials.email, subject: 'Teste', text: 'Teste de envio' })).run()
    await flushEmailOutbox(deliveryEnv)
    let retry = await db.prepare("SELECT status, attempts FROM email_outbox WHERE id = 'retry-job'").first()
    assert.equal(retry.status, 'pending')
    assert.equal(retry.attempts, 1)
    await db.prepare("UPDATE email_outbox SET next_attempt_at = 0 WHERE id = 'retry-job'").run()
    const sent = []
    deliveryEnv.EMAIL.send = async (message) => { sent.push(message); return { messageId: 'fake-id' } }
    await Promise.all([flushEmailOutbox(deliveryEnv), flushEmailOutbox(deliveryEnv)])
    assert.equal(sent.length, 1)
    retry = await db.prepare("SELECT status, payload FROM email_outbox WHERE id = 'retry-job'").first()
    assert.equal(retry.status, 'sent')
    assert.equal(retry.payload, null)
    // Preview messages remain previews even if live sending is enabled later.
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE status = 'preview'").first()).count >= 3, true)
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
