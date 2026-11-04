import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('accounts, sessions, profiles and tenant isolation work in the Cloudflare runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-accounts-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'accounts-integration' },
    bindings: { EMAIL_MODE: 'preview', APP_URL: 'https://localhost' } })
  options.resourcePersistencePath = directory
  let runtime = new Miniflare(options)
  async function request(path, method = 'GET', body, cookie = '', headers = {}) {
    return runtime.dispatchFetch(`https://localhost/api/${path}`, { method,
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  const credentials = { email: 'Owner@Example.com', password: 'uma frase longa e segura', full_name: 'Diogo',
    business_name: 'Negócio Um', slug: 'negocio-um' }
  const cookieOf = (response) => response.headers.get('Set-Cookie').split(';')[0]
  try {
    let db = await runtime.getD1Database('booking_saas_db')
    for (const file of ['0001_initial_schema.sql', '0002_accounts.sql', '0003_subscription_trials.sql', '0004_availability.sql', '0005_email_notifications.sql', '0006_booking_payment_settings.sql', '0007_public_bookings.sql', '0008_booking_lifecycle.sql']) {
      const schema = await readFile(`migrations/${file}`, 'utf8')
      for (const statement of schema.split(';').filter((part) => part.trim())) await db.prepare(statement).run()
    }
    for (const path of ['services', 'bookings?date=2090-01-01', 'auth/session']) {
      assert.equal((await request(path)).status, 401)
    }
    assert.equal((await request('auth/register', 'POST', { ...credentials, slug: 'admin' })).status, 400)
    assert.equal((await request('auth/register', 'POST', { ...credentials, password: 'short' })).status, 400)
    const registered = await request('auth/register', 'POST', credentials)
    assert.equal(registered.status, 201)
    assert.match(registered.headers.get('Set-Cookie'), /HttpOnly/)
    assert.match(registered.headers.get('Set-Cookie'), /SameSite=Lax/)
    assert.match(registered.headers.get('Set-Cookie'), /Secure/)
    assert.equal(registered.headers.get('Cache-Control'), 'no-store')
    let cookieA = cookieOf(registered)
    let accountA = await registered.json()
    const trialEndsAt = accountA.subscription.trial_ends_at
    assert.equal(accountA.subscription.status, 'trialing')
    assert.ok(trialEndsAt > Date.now() + 14 * 86_400_000 - 60_000)
    assert.ok(trialEndsAt <= Date.now() + 14 * 86_400_000)
    assert.equal(accountA.user.email, 'owner@example.com')
    assert.notEqual(accountA.organization.id, 'org-demo')
    assert.equal('password_hash' in accountA.user, false)
    const stored = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(accountA.user.id).first()
    assert.match(stored.password_hash, /^scrypt:16384:8:5:/)
    assert.equal(stored.password_hash.includes(credentials.password), false)
    const rawToken = cookieA.split('=')[1]
    assert.equal(await db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').bind(rawToken).first(), null)
    assert.equal((await request('auth/register', 'POST', credentials)).status, 409)
    assert.equal((await request('auth/register', 'POST', { ...credentials, email: 'second@example.com' })).status, 409)
    const second = await request('auth/register', 'POST', { ...credentials, email: 'second@example.com', slug: 'negocio-dois' })
    assert.equal(second.status, 201)
    const cookieB = cookieOf(second)
    const accountB = await second.json()
    assert.notEqual(accountA.organization.id, accountB.organization.id)
    const hashB = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(accountB.user.id).first()
    assert.notEqual(hashB.password_hash, stored.password_hash)
    const created = await request('services', 'POST', { name: 'Privado A', duration_minutes: 30, price_cents: 1500 }, cookieA)
    assert.equal(created.status, 201)
    const service = await created.json()
    assert.deepEqual((await (await request('services', 'GET', undefined, cookieB)).json()).services, [])
    assert.equal((await request(`services/${service.id}`, 'PATCH', { name: 'Ataque' }, cookieB)).status, 404)
    assert.equal((await request(`services/${service.id}/duration-preview`, 'POST', { duration_minutes: 60 }, cookieB)).status, 404)
    const bookingInput = { customer_name: 'Cliente A', service_id: service.id, date: '2090-01-01', start_time: '10:00' }
    assert.equal((await request('bookings', 'POST', bookingInput, cookieB)).status, 400)
    const booked = await request('bookings', 'POST', bookingInput, cookieA)
    assert.equal(booked.status, 201)
    const booking = await booked.json()
    assert.deepEqual((await (await request('bookings?date=2090-01-01', 'GET', undefined, cookieB)).json()).bookings, [])
    assert.equal((await request(`bookings/${booking.id}`, 'DELETE', undefined, cookieB)).status, 404)
    assert.equal((await request(`services/${service.id}`, 'PATCH', { name: 'CSRF' }, cookieA, { Origin: 'https://evil.example' })).status, 403)
    assert.equal((await request('auth/logout', 'POST', {}, cookieA, { 'Content-Type': 'text/plain' })).status, 415)
    const profile = { ...accountA.organization, full_name: 'Diogo Novo', name: 'Novo Negócio', slug: 'novo-negocio',
      description: 'Marcações para todos.', contact_email: 'contacto@example.com', phone: '+351 900 000 000',
      brand_color: '#224466', logo_url: 'https://example.com/logo.png' }
    assert.equal((await request('profile', 'PATCH', { ...profile, slug: 'negocio-dois' }, cookieA)).status, 409)
    assert.equal((await request('profile', 'PATCH', { ...profile, logo_url: 'javascript:alert(1)' }, cookieA)).status, 400)
    const updated = await request('profile', 'PATCH', profile, cookieA)
    assert.equal(updated.status, 200)
    accountA = await updated.json()
    assert.equal(accountA.organization.slug, 'novo-negocio')
    assert.equal((await (await request('auth/session', 'GET', undefined, cookieB)).json()).organization.slug, 'negocio-dois')
    await runtime.dispose()
    runtime = new Miniflare(options)
    db = await runtime.getD1Database('booking_saas_db')
    assert.equal((await (await request('auth/session', 'GET', undefined, cookieA)).json()).user.full_name, 'Diogo Novo')
    assert.equal((await request('auth/login', 'POST', { email: credentials.email, password: 'palavra passe errada' })).status, 401)
    const loggedIn = await request('auth/login', 'POST', credentials, cookieA)
    assert.equal(loggedIn.status, 200)
    assert.equal((await loggedIn.clone().json()).subscription.trial_ends_at, trialEndsAt)
    const oldCookie = cookieA
    cookieA = cookieOf(loggedIn)
    assert.notEqual(cookieA, oldCookie)
    assert.equal((await request('auth/session', 'GET', undefined, oldCookie)).status, 401)
    const otherLogin = await request('auth/login', 'POST', credentials)
    const otherSession = cookieOf(otherLogin)
    assert.equal((await request('auth/password', 'POST', { current_password: 'uma passe incorreta', new_password: 'outra frase muito segura' }, cookieA)).status, 400)
    const changed = await request('auth/password', 'POST', { current_password: credentials.password, new_password: 'outra frase muito segura' }, cookieA)
    assert.equal(changed.status, 202)
    assert.equal((await request('auth/session', 'GET', undefined, cookieA)).status, 200)
    const notification = await db.prepare("SELECT payload FROM email_outbox WHERE kind = 'password_request' AND organization_id = ?")
      .bind(accountA.organization.id).first()
    const token = JSON.parse(notification.payload).text.match(/change-password=([A-Za-z0-9_-]+)/)[1]
    assert.equal((await request('auth/password/confirm', 'POST', { token, new_password: 'outra frase muito segura' })).status, 200)
    const beforeChange = cookieA
    assert.equal((await request('auth/session', 'GET', undefined, beforeChange)).status, 401)
    assert.equal((await request('auth/session', 'GET', undefined, otherSession)).status, 401)
    assert.equal((await request('auth/login', 'POST', credentials)).status, 401)
    const newLogin = await request('auth/login', 'POST', { email: credentials.email, password: 'outra frase muito segura' })
    assert.equal(newLogin.status, 200)
    cookieA = cookieOf(newLogin)
    assert.equal((await request('auth/logout', 'POST', {}, cookieA)).status, 204)
    assert.equal((await request('services', 'GET', undefined, cookieA)).status, 401)
    await db.prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?').bind(accountB.user.id).run()
    assert.equal((await request('services', 'GET', undefined, cookieB)).status, 401)
    assert.equal((await request('services', 'GET', undefined, 'booking_session=forged')).status, 401)
    for (let i = 0; i < 31; i++) {
      const response = await request('auth/login', 'POST', { email: 'invalid', password: '' }, '', { 'CF-Connecting-IP': '192.0.2.99' })
      assert.equal(response.status, i < 30 ? 400 : 429)
    }
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
