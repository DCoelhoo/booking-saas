import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo, demoCookie } from './account-fixture.mjs'
import { subscriptionAccess } from '../worker/subscriptions.ts'

test('subscription access ends at the exact deadline and canceled periods retain prepaid access', () => {
  const fields = { trial_started_at: 1000, trial_ends_at: 2000, subscription_status: 'inactive', paid_until: 0 }
  assert.equal(subscriptionAccess(fields, 1999).can_manage, true)
  assert.equal(subscriptionAccess(fields, 2000).can_manage, false)
  assert.equal(subscriptionAccess(fields, 2000).days_remaining, 0)
  assert.equal(subscriptionAccess({ ...fields, subscription_status: 'active', paid_until: 3000 }, 2500).status, 'active')
  assert.equal(subscriptionAccess({ ...fields, subscription_status: 'canceled', paid_until: 3000 }, 2999).can_manage, true)
  assert.equal(subscriptionAccess({ ...fields, subscription_status: 'active', paid_until: 3000 }, 3000).can_manage, false)
  assert.equal(subscriptionAccess({ ...fields, subscription_status: 'past_due', paid_until: 3000 }, 2500).can_manage, false)
})

test('expired businesses retain reads, account management, cancellation and isolated exports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-subscriptions-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'subscription-integration' } })
  options.resourcePersistencePath = directory
  let runtime = new Miniflare(options)
  async function request(path, method = 'GET', body, cookie = demoCookie) {
    return runtime.dispatchFetch(`http://localhost/api/${path}`, {
      method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  try {
    let db = await runtime.getD1Database('booking_saas_db')
    const schema = await readFile('migrations/0001_initial_schema.sql', 'utf8')
    for (const statement of schema.split(';').filter((part) => part.trim())) await db.prepare(statement).run()
    await db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-demo', 'Demo', 'demo'), ('other', 'Outro', 'outro')").run()
    await authenticateDemo(db)
    await db.prepare("INSERT INTO users (id, organization_id, email, full_name, password_hash) VALUES ('other-user', 'other', 'other@example.com', 'Outro', 'not-used-for-login')").run()
    const otherToken = 'b'.repeat(43)
    await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(createHash('sha256').update(otherToken).digest('hex'), 'other-user', Date.now() + 3_600_000).run()
    assert.equal((await request('subscription', 'GET', undefined, '')).status, 401)
    assert.equal((await request('export', 'GET', undefined, '')).status, 401)
    let subscription = await (await request('subscription')).json()
    assert.equal(subscription.status, 'trialing')
    assert.equal(subscription.days_remaining, 14)
    assert.equal(subscription.monthly_price_cents, 1000)
    assert.equal(subscription.billing_available, false)
    const serviceResponse = await request('services', 'POST', { name: 'Serviço', duration_minutes: 30, price_cents: 1000 })
    const service = await serviceResponse.json()
    const booked = await request('bookings', 'POST', { customer_name: 'Cliente', service_id: service.id, date: '2090-01-01', start_time: '10:00' })
    assert.equal(booked.status, 201)
    const booking = await booked.json()
    await db.prepare("INSERT INTO services (id, organization_id, name, duration_minutes, price_cents) VALUES ('private', 'other', 'Serviço privado', 30, 1000)").run()
    await db.prepare("UPDATE organizations SET trial_ends_at = ?, trial_started_at = ? WHERE id = 'org-demo'")
      .bind(Date.now() - 1000, Date.now() - 15 * 86_400_000).run()
    subscription = await (await request('subscription')).json()
    assert.equal(subscription.status, 'expired')
    assert.equal(subscription.can_manage, false)
    for (const [path, method, body] of [
      ['services', 'POST', { name: 'Bloqueado', duration_minutes: 30, price_cents: 0 }],
      [`services/${service.id}`, 'PATCH', { duration_minutes: 60 }],
      [`services/${service.id}`, 'PATCH', { is_active: 0 }],
      [`services/${service.id}/duration-preview`, 'POST', { duration_minutes: 60 }],
      ['bookings', 'POST', { customer_name: 'Bloqueado', service_id: service.id, date: '2090-01-02', start_time: '10:00' }],
    ]) {
      const response = await request(path, method, body)
      assert.equal(response.status, 402)
      assert.equal((await response.json()).code, 'SUBSCRIPTION_REQUIRED')
    }
    const account = await (await request('auth/session')).json()
    const profile = { ...account.organization, full_name: 'Nome pessoal atualizado' }
    assert.equal((await request('profile', 'PATCH', { ...profile, name: 'Bloqueado' })).status, 402)
    assert.equal((await request('profile', 'PATCH', profile)).status, 200)
    // A client cannot grant itself paid access or extend its trial through profile fields.
    assert.equal((await request('profile', 'PATCH', { ...profile, subscription_status: 'active', paid_until: Date.now() + 86_400_000 })).status, 200)
    assert.equal((await (await request('subscription')).json()).can_manage, false)
    const exported = await request('export')
    assert.equal(exported.status, 200)
    assert.match(exported.headers.get('Content-Disposition'), /attachment/)
    const data = await exported.json()
    assert.equal(data.services.length, 1)
    assert.equal(data.services[0].id, service.id)
    assert.equal(data.bookings.length, 1)
    assert.equal(data.bookings[0].id, booking.id)
    assert.equal(JSON.stringify(data).includes('password_hash'), false)
    assert.equal(JSON.stringify(data).includes('token_hash'), false)
    const otherExport = await (await request('export', 'GET', undefined, `booking_session=${otherToken}`)).json()
    assert.equal(otherExport.services[0].id, 'private')
    assert.deepEqual(otherExport.bookings, [])
    assert.equal((await request('bookings?date=2090-01-01')).status, 200)
    assert.equal((await request(`bookings/${booking.id}`, 'DELETE')).status, 204)
    // Prepared paid-state support: an authenticated provider will set these fields later.
    await db.prepare("UPDATE organizations SET subscription_status = 'canceled', paid_until = ? WHERE id = 'org-demo'")
      .bind(Date.now() + 86_400_000).run()
    assert.equal((await request(`services/${service.id}`, 'PATCH', { name: 'Pago até ao fim' })).status, 200)
    await db.prepare("UPDATE organizations SET paid_until = ? WHERE id = 'org-demo'").bind(Date.now() - 1000).run()
    await runtime.dispose()
    runtime = new Miniflare(options)
    db = await runtime.getD1Database('booking_saas_db')
    assert.equal((await (await request('subscription')).json()).can_manage, false)
    assert.deepEqual((await (await request('bookings?date=2090-01-01')).json()).bookings, [])
    assert.equal((await (await request('auth/session')).json()).user.full_name, 'Nome pessoal atualizado')
    assert.equal((await request('auth/logout', 'POST', {})).status, 204)
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
