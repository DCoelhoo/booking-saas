import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo, demoCookie } from './account-fixture.mjs'
import { paymentQuote, validatePaymentSettings } from '../shared/bookingPayments.ts'

test('booking payment calculations preserve cents and cap deposits at the service price', () => {
  const settings = { mode: 'deposit', deposit_type: 'percentage', deposit_value: 30 }
  assert.equal(paymentQuote(5000, settings).online_due_cents, 1500)
  assert.equal(paymentQuote(5000, settings).on_site_due_cents, 3500)
  assert.equal(paymentQuote(999, settings).online_due_cents, 300)
  assert.equal(paymentQuote(1, settings).online_due_cents, 1)
  assert.equal(paymentQuote(0, settings).requires_online_payment, false)
  assert.equal(paymentQuote(500, { ...settings, deposit_type: 'fixed', deposit_value: 1000 }).online_due_cents, 500)
  assert.equal(paymentQuote(5000, { ...settings, mode: 'on_site' }).online_due_cents, 0)
  assert.equal(paymentQuote(5000, { ...settings, mode: 'full_online' }).online_due_cents, 5000)
  assert.equal(paymentQuote(5000, { ...settings, mode: 'full_online' }).can_confirm_public_booking, false)
  assert.equal(paymentQuote(Number.MAX_SAFE_INTEGER, { ...settings, deposit_value: 99 }).online_due_cents,
    Number((BigInt(Number.MAX_SAFE_INTEGER) * 99n + 50n) / 100n))
  for (const invalid of [null, [], { mode: 'unknown' }, { ...settings, deposit_value: 0 },
    { ...settings, deposit_value: 100 }, { ...settings, deposit_value: 30.5 },
    { ...settings, deposit_type: 'fixed', deposit_value: -1 }, { ...settings, deposit_value: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(validatePaymentSettings(invalid), null)
  }
})

test('business payment settings persist, remain scoped and never activate online charges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-payment-settings-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'payment-settings-integration' } })
  options.resourcePersistencePath = directory
  let runtime = new Miniflare(options)
  const request = (path, method = 'GET', body, cookie = demoCookie) => runtime.dispatchFetch(`http://localhost/api/${path}`, {
    method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  try {
    let db = await runtime.getD1Database('booking_saas_db')
    const schema = await readFile('migrations/0001_initial_schema.sql', 'utf8')
    for (const statement of schema.split(';').filter((part) => part.trim())) await db.prepare(statement).run()
    await db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-demo', 'Demo', 'demo'), ('other', 'Outro', 'outro')").run()
    await authenticateDemo(db)
    await db.prepare("INSERT INTO services (id, organization_id, name, duration_minutes, price_cents) VALUES ('service', 'org-demo', 'Serviço', 30, 5000), ('free', 'org-demo', 'Gratuito', 30, 0), ('private', 'other', 'Privado', 30, 5000)").run()
    const defaultSettings = { mode: 'on_site', deposit_type: 'percentage', deposit_value: 30 }
    assert.equal((await request('booking-payment-settings', 'GET', undefined, '')).status, 401)
    assert.deepEqual(await (await request('booking-payment-settings')).json(), defaultSettings)
    let quote = await (await request('services/service/payment-quote')).json()
    assert.equal(quote.online_due_cents, 0)
    assert.equal(quote.on_site_due_cents, 5000)
    assert.equal(quote.can_confirm_public_booking, true)
    const deposit = { mode: 'deposit', deposit_type: 'percentage', deposit_value: 30 }
    assert.equal((await request('booking-payment-settings', 'PUT', { ...deposit, organization_id: 'other' })).status, 200)
    assert.deepEqual(JSON.parse((await db.prepare("SELECT booking_payment_settings FROM organizations WHERE id = 'other'").first()).booking_payment_settings), defaultSettings)
    quote = await (await request('services/service/payment-quote')).json()
    assert.equal(quote.online_due_cents, 1500)
    assert.equal(quote.on_site_due_cents, 3500)
    assert.equal(quote.online_payments_available, false)
    assert.equal(quote.can_confirm_public_booking, false)
    assert.equal((await request('services/private/payment-quote')).status, 404)
    assert.equal((await (await request('services/free/payment-quote')).json()).can_confirm_public_booking, true)
    assert.equal((await request('booking-payment-settings', 'PUT', { ...deposit, deposit_value: 100 })).status, 400)
    const full = await request('booking-payment-settings', 'PUT', { mode: 'full_online', online_payments_available: true })
    assert.equal(full.status, 200)
    quote = await (await request('services/service/payment-quote')).json()
    assert.equal(quote.online_due_cents, 5000)
    assert.equal(quote.on_site_due_cents, 0)
    assert.equal(quote.online_payments_available, false)
    const fixed = { mode: 'deposit', deposit_type: 'fixed', deposit_value: 1000 }
    assert.equal((await request('booking-payment-settings', 'PUT', fixed)).status, 200)
    assert.equal((await (await request('services/service/payment-quote')).json()).online_due_cents, 1000)
    await runtime.dispose()
    runtime = new Miniflare(options)
    db = await runtime.getD1Database('booking_saas_db')
    assert.deepEqual(await (await request('booking-payment-settings')).json(), fixed)
    assert.deepEqual((await (await request('export')).json()).booking_payment_settings, fixed)
    assert.equal((await request('booking-payment-settings', 'PUT', defaultSettings)).status, 200)
    await db.prepare("UPDATE organizations SET trial_ends_at = 0 WHERE id = 'org-demo'").run()
    assert.equal((await request('booking-payment-settings')).status, 200)
    assert.equal((await request('booking-payment-settings', 'PUT', defaultSettings)).status, 402)
    assert.equal((await request('services/service/payment-quote')).status, 200)
    assert.equal((await (await request('services/service/payment-quote')).json()).can_confirm_public_booking, false)
    assert.equal((await (await request('subscription')).json()).monthly_price_cents, 1000)
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
