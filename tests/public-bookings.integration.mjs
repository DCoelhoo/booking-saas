import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo, demoCookie } from './account-fixture.mjs'
import { businessNow } from '../worker/businessTime.ts'

test('public bookings respect availability, privacy, payments, idempotency and concurrent reservations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-public-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'public-integration' },
    bindings: { EMAIL_MODE: 'preview', APP_URL: 'http://localhost' } })
  options.resourcePersistencePath = directory
  let runtime = new Miniflare(options)
  const request = (path, method = 'GET', body, headers = {}) => runtime.dispatchFetch(`http://localhost/api/${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  function day(offset) {
    const date = new Date(`${businessNow().slice(0, 10)}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  const body = (extra = {}) => ({ request_id: randomUUID(), service_id: 'service', date: day(1), start_time: '10:00',
    customer_name: 'Cliente Público', customer_email: 'client@example.test', customer_phone: '+351 900 000 000',
    expected_price_cents: 5000, expected_duration_minutes: 30, website: '', ...extra })
  const book = (input, headers) => request('public/demo/bookings', 'POST', input, headers)
  try {
    let db = await runtime.getD1Database('booking_saas_db')
    const schema = await readFile('migrations/0001_initial_schema.sql', 'utf8')
    for (const statement of schema.split(';').filter((part) => part.trim())) await db.prepare(statement).run()
    await db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-demo', 'Demo', 'demo'), ('other', 'Outro', 'outro'), ('unclaimed', 'Antigo', 'antigo')").run()
    await authenticateDemo(db)
    await db.prepare("INSERT INTO users (id, organization_id, email, full_name, password_hash) VALUES ('other-user', 'other', 'private@example.test', 'Outro', 'unused')").run()
    await db.prepare("INSERT INTO services (id, organization_id, name, duration_minutes, price_cents, is_active) VALUES ('service', 'org-demo', 'Consulta', 30, 5000, 1), ('free', 'org-demo', 'Gratuito', 30, 0, 1), ('inactive', 'org-demo', 'Inativo', 30, 1000, 0), ('private', 'other', 'Privado', 30, 1000, 1)").run()
    const availability = { weekly: Array.from({ length: 7 }, () => [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }]),
      closures: [{ start_date: day(2), end_date: day(2), reason: 'Privado' }] }
    await db.prepare("UPDATE organizations SET availability = ? WHERE id = 'org-demo'").bind(JSON.stringify(availability)).run()
    const page = await (await request('public/demo')).json()
    assert.equal(page.available, true)
    assert.equal(page.services.length, 2)
    for (const secret of ['password_hash', 'fixture@example.com', 'trial_ends_at', 'subscription_status', 'Privado']) assert.equal(JSON.stringify(page).includes(secret), false)
    assert.equal((await request('public/antigo')).status, 404)
    assert.equal((await request('public/missing')).status, 404)
    assert.equal((await request('bookings?date=' + day(1))).status, 401)
    let slots = (await (await request(`public/demo/slots?service_id=service&date=${day(1)}`)).json()).slots
    assert.ok(slots.some((slot) => slot.start_time === '11:30'))
    assert.equal(slots.some((slot) => slot.start_time === '11:45' || slot.start_time === '12:00'), false)
    assert.deepEqual((await (await request(`public/demo/slots?service_id=service&date=${day(2)}`)).json()).slots, [])
    assert.equal((await request(`public/demo/slots?service_id=private&date=${day(1)}`)).status, 404)
    assert.equal((await request(`public/demo/slots?service_id=service&date=${day(-1)}`)).status, 400)
    assert.equal((await request(`public/demo/slots?service_id=service&date=${day(91)}`)).status, 400)
    const original = body()
    const rival = body({ customer_email: 'rival@example.test' })
    const race = await Promise.all([book(original), book(rival)])
    assert.deepEqual(race.map((response) => response.status).sort(), [201, 409])
    const winnerInput = race[0].status === 201 ? original : rival
    const winner = await race.find((response) => response.status === 201).json()
    assert.equal(winner.booking.total_cents, 5000)
    assert.equal(winner.booking.on_site_due_cents, 5000)
    assert.equal(winner.payment_status, 'not_collected')
    assert.equal('customer_email' in winner.booking, false)
    assert.equal((await (await book(winnerInput)).json()).booking.id, winner.booking.id)
    assert.equal((await book({ ...winnerInput, customer_name: 'Outro cliente' })).status, 409)
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM bookings').first()).count, 1)
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM email_outbox').first()).count, 2)
    const customerEmail = await db.prepare("SELECT payload FROM email_outbox WHERE kind = 'booking_confirmation'").first()
    assert.equal(JSON.parse(customerEmail.payload).to, winnerInput.customer_email)
    slots = (await (await request(`public/demo/slots?service_id=service&date=${day(1)}`)).json()).slots
    assert.equal(slots.some((slot) => ['09:45', '10:00', '10:15'].includes(slot.start_time)), false)
    assert.ok(slots.some((slot) => slot.start_time === '10:30'))
    assert.equal(JSON.stringify(slots).includes(winnerInput.customer_email), false)
    for (const extra of [{ start_time: '09:07' }, { start_time: '13:00' }, { date: day(2) },
      { expected_price_cents: 4999 }, { expected_duration_minutes: 60 }, { service_id: 'private' }, { service_id: 'inactive' }]) {
      assert.equal((await book(body({ customer_email: randomUUID() + '@example.test', ...extra }))).status, 409)
    }
    assert.equal((await book(body({ customer_email: 'invalid' }))).status, 400)
    assert.equal((await book(body({ date: day(-1) }))).status, 400)
    assert.equal((await book(body({ website: 'spam' }))).status, 400)
    assert.equal((await book(body(), { Origin: 'https://evil.example' })).status, 403)
    await db.prepare("UPDATE organizations SET booking_payment_settings = ? WHERE id = 'org-demo'")
      .bind(JSON.stringify({ mode: 'full_online', deposit_type: 'percentage', deposit_value: 30 })).run()
    assert.equal((await book(body({ start_time: '14:00', customer_email: 'pay@example.test' }))).status, 409)
    assert.equal((await request(`public/demo/slots?service_id=service&date=${day(1)}`)).status, 403)
    assert.equal((await book(body({ service_id: 'free', expected_price_cents: 0, start_time: '14:00', customer_email: 'free@example.test' }))).status, 201)
    await request('services/service', 'PATCH', { name: 'Renomeado', price_cents: 6000 }, { Cookie: demoCookie })
    const unchanged = await (await book(winnerInput)).json()
    assert.equal(unchanged.booking.service_name, 'Consulta')
    assert.equal(unchanged.booking.total_cents, 5000)
    await db.prepare("UPDATE organizations SET trial_ends_at = 0 WHERE id = 'org-demo'").run()
    const expired = await (await request('public/demo')).json()
    assert.equal(expired.available, false)
    assert.deepEqual(expired.services, [])
    assert.equal((await book(body())).status, 403)
    assert.equal((await book(winnerInput)).status, 201)
    await runtime.dispose()
    runtime = new Miniflare(options)
    db = await runtime.getD1Database('booking_saas_db')
    const own = await (await request('bookings?date=' + day(1), 'GET', undefined, { Cookie: demoCookie })).json()
    assert.equal(own.bookings.length, 2)
    assert.ok(own.bookings.some((booking) => booking.customer_email === winnerInput.customer_email))
    assert.equal((await (await request('export', 'GET', undefined, { Cookie: demoCookie })).json()).bookings.length, 2)
    await db.prepare("UPDATE organizations SET trial_ends_at = ?, booking_payment_settings = ? WHERE id = 'org-demo'")
      .bind(Date.now() + 86_400_000, JSON.stringify({ mode: 'on_site', deposit_type: 'percentage', deposit_value: 30 })).run()
    const repeated = body({ date: day(3), expected_price_cents: 6000, customer_email: 'repeat@example.test' })
    const repeats = await Promise.all([book(repeated), book(repeated)])
    assert.deepEqual(repeats.map((response) => response.status), [201, 201])
    assert.equal((await repeats[0].json()).booking.id, (await repeats[1].json()).booking.id)
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM bookings WHERE public_request_id = ?').bind(repeated.request_id).first()).count, 1)
    await db.prepare("UPDATE organizations SET availability = ? WHERE id = 'org-demo'")
      .bind(JSON.stringify({ weekly: Array.from({ length: 7 }, () => [{ start: '09:10', end: '18:00' }]), closures: [] })).run()
    const offsetSlots = (await (await request(`public/demo/slots?service_id=service&date=${day(4)}`)).json()).slots
    assert.equal(offsetSlots[0].start_time, '09:10')
    assert.equal((await book(body({ date: day(4), start_time: '09:10', expected_price_cents: 6000, customer_email: 'offset@example.test' }))).status, 201)
    assert.equal((await book(body({ date: day(4), start_time: '10:15', expected_price_cents: 6000, customer_email: 'off-grid@example.test' }))).status, 409)
    for (let i = 0; i < 31; i++) {
      const response = await book(body({ start_time: '09:07', expected_price_cents: 6000, customer_email: `rate${i}@example.test` }), { 'CF-Connecting-IP': '192.0.2.88' })
      assert.equal(response.status, i < 30 ? 409 : 429)
    }
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
