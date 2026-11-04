import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo, demoCookie } from './account-fixture.mjs'
import { businessNow } from '../worker/businessTime.ts'

test('booking lifecycle preserves history, guards deadlines and atomically reschedules through private links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-lifecycle-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js', compatibilityDate: '2026-10-19',
    d1Databases: { booking_saas_db: 'lifecycle' }, bindings: { EMAIL_MODE: 'preview', APP_URL: 'http://localhost' } })
  options.resourcePersistencePath = directory
  const runtime = new Miniflare(options)
  const request = (path, method = 'GET', body, headers = {}) => runtime.dispatchFetch(`http://localhost/api/${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const owner = (path, method = 'GET', body) => request(path, method, body, { Cookie: demoCookie })
  function day(offset) { return new Date(Date.parse(`${businessNow().slice(0, 10)}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10) }
  try {
    const db = await runtime.getD1Database('booking_saas_db')
    for (const sql of (await readFile('migrations/0001_initial_schema.sql', 'utf8')).split(';').filter((s) => s.trim())) await db.prepare(sql).run()
    await db.prepare("INSERT INTO organizations (id,name,slug) VALUES ('org-demo','Demo','demo'), ('other','Other','other')").run()
    await authenticateDemo(db)
    await db.prepare("INSERT INTO services(id,organization_id,name,duration_minutes,price_cents) VALUES ('service','org-demo','Consulta',30,5000),('foreign','other','Privado',30,100)").run()
    await db.prepare("UPDATE organizations SET availability = ? WHERE id = 'org-demo'").bind(JSON.stringify({ weekly: Array.from({ length: 7 }, () => [{ start: '09:00', end: '18:00' }]), closures: [] })).run()
    const input = { service_id: 'service', customer_name: 'Cliente', customer_email: 'client@example.test', customer_phone: '', date: day(3), start_time: '10:00',
      request_id: randomUUID(), expected_price_cents: 5000, expected_duration_minutes: 30 }
    const created = await request('public/demo/bookings', 'POST', input)
    assert.equal(created.status, 201)
    const { booking } = await created.json()
    const queued = await db.prepare("SELECT payload FROM email_outbox WHERE id = ?").bind(`booking-confirmed:${booking.id}`).first()
    const text = JSON.parse(queued.payload).text
    const token = text.match(/#token=([\w-]+)/)[1]
    assert.equal(token.length, 43)
    const auth = { Authorization: `Bearer ${token}` }
    const manage = (method = 'GET', body) => request('booking-management', method, body, auth)
    assert.equal((await request('booking-management')).status, 404)
    assert.equal((await request('booking-management', 'GET', undefined, { Authorization: 'Bearer ' + 'x'.repeat(43) })).status, 404)
    const data = await (await manage()).json()
    assert.equal(data.can_cancel, true)
    assert.equal(data.can_reschedule, true)
    for (const secret of [token, 'customer_email', 'client@example.test', 'management_token_hash', 'password_hash', 'subscription_status']) assert.equal(JSON.stringify(data).includes(secret), false)
    assert.equal((await db.prepare('SELECT management_token_hash FROM bookings WHERE id = ?').bind(booking.id).first()).management_token_hash.includes(token), false)
    const slots = await (await request(`booking-management/slots?date=${day(3)}`, 'GET', undefined, auth)).json()
    assert.ok(slots.slots.some((s) => s.start_time === '10:00'), 'own booking is excluded')
    assert.equal((await manage('POST', { action: 'completed', version: 1 })).status, 400)
    assert.equal((await manage('POST', { action: 'reschedule', version: 1, date: day(3), start_time: '10:05' })).status, 409)
    const moved = await manage('POST', { action: 'reschedule', version: 1, date: day(3), start_time: '11:00' })
    assert.equal(moved.status, 200, await moved.clone().text())
    assert.equal((await moved.json()).version, 2)
    let stored = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(booking.id).first()
    assert.equal(stored.start_at, `${day(3)}T11:00:00`)
    assert.equal(stored.total_cents, 5000)
    assert.equal((await manage('POST', { action: 'canceled', version: 1 })).status, 409)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM booking_events').first()).n, 1)
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'booking_changed'").first()).n, 2)
    // Losing a race with a new reservation keeps the original booking intact.
    assert.equal((await owner('bookings', 'POST', { customer_name: 'Outro', service_id: 'service', date: day(3), start_time: '12:00' })).status, 201)
    assert.equal((await manage('POST', { action: 'reschedule', version: 2, date: day(3), start_time: '12:00' })).status, 409)
    assert.equal((await db.prepare('SELECT start_at FROM bookings WHERE id = ?').bind(booking.id).first()).start_at, stored.start_at)
    await db.prepare("UPDATE organizations SET availability = json_set(availability, '$.closures', json(?)) WHERE id = 'org-demo'").bind(JSON.stringify([{ start_date: day(6), end_date: day(6), reason: 'Privado' }])).run()
    assert.equal((await manage('POST', { action: 'reschedule', version: 2, date: day(6), start_time: '10:00' })).status, 409)
    assert.deepEqual((await (await request(`booking-management/slots?date=${day(6)}`, 'GET', undefined, auth)).json()).slots, [])
    // Same-version mutations compete: exactly one event and one pair of messages.
    const race = await Promise.all([manage('POST', { action: 'reschedule', version: 2, date: day(3), start_time: '13:00' }), manage('POST', { action: 'canceled', version: 2 })])
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409])
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM booking_events').first()).n, 2)
    // Policy is scoped and enforced server-side even if the page was opened before it changed.
    assert.equal((await owner('booking-change-policy', 'PUT', { hours: -1 })).status, 400)
    assert.equal((await owner('booking-change-policy', 'PUT', { hours: 720 })).status, 200)
    stored = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(booking.id).first()
    assert.equal((await manage()).status, 200)
    assert.equal((await (await manage()).json()).can_cancel, false)
    if (stored.status === 'confirmed') assert.equal((await manage('POST', { action: 'canceled', version: stored.version })).status, 403)
    await owner('booking-change-policy', 'PUT', { hours: 24 })
    // Cross-tenant state changes and premature completion are rejected.
    await db.prepare("INSERT INTO bookings(id,organization_id,service_id,customer_name,start_at,end_at) VALUES ('private','other','foreign','Secret',?,?)").bind(`${day(3)}T10:00:00`, `${day(3)}T10:30:00`).run()
    assert.equal((await owner('bookings/private', 'PATCH', { status: 'canceled', version: 1 })).status, 404)
    const future = await (await owner('bookings', 'POST', { customer_name: 'Futuro', service_id: 'service', date: day(4), start_time: '10:00' })).json()
    assert.equal((await owner(`bookings/${future.id}`, 'PATCH', { status: 'completed', version: 1 })).status, 400)
    assert.equal((await owner(`bookings/${future.id}`, 'PATCH', { status: 'no_show', version: 1 })).status, 400)
    // Completed and no-show records are terminal and survive in history.
    for (const [id, status] of [['done', 'completed'], ['absent', 'no_show']]) {
      await db.prepare("INSERT INTO bookings(id,organization_id,service_id,customer_name,start_at,end_at) VALUES (?,'org-demo','service','Passado',?,?)").bind(id, `${day(-2)}T09:00:00`, `${day(-2)}T09:30:00`).run()
      assert.equal((await owner(`bookings/${id}`, 'PATCH', { status, version: 1 })).status, 200)
      assert.equal((await owner(`bookings/${id}`, 'PATCH', { status: 'canceled', version: 2 })).status, 409)
    }
    // Cancellation releases capacity, and closed dates cannot be used when rescheduling.
    const another = await request('public/demo/bookings', 'POST', { ...input, request_id: randomUUID(), date: day(5) })
    assert.equal(another.status, 201)
    const anotherId = (await another.json()).booking.id
    const anotherMessage = await db.prepare('SELECT payload FROM email_outbox WHERE id = ?').bind(`booking-confirmed:${anotherId}`).first()
    const anotherAuth = { Authorization: `Bearer ${JSON.parse(anotherMessage.payload).text.match(/#token=([\w-]+)/)[1]}` }
    const before = (await (await request(`public/demo/slots?service_id=service&date=${day(5)}`)).json()).slots
    assert.equal(before.some((s) => s.start_time === '10:00'), false)
    // Expired owners and customers may cancel, while rescheduling remains blocked.
    await db.prepare("UPDATE organizations SET trial_ends_at = 0 WHERE id = 'org-demo'").run()
    assert.equal((await request('booking-management', 'POST', { action: 'reschedule', version: 1, date: day(6), start_time: '10:00' }, anotherAuth)).status, 403)
    assert.equal((await request('booking-management', 'POST', { action: 'canceled', version: 1 }, anotherAuth)).status, 200)
    await db.prepare("UPDATE organizations SET trial_ends_at = ? WHERE id = 'org-demo'").bind(Date.now() + 86400000).run()
    const freed = (await (await request(`public/demo/slots?service_id=service&date=${day(5)}`)).json()).slots
    assert.ok(freed.some((s) => s.start_time === '10:00'))
    await db.prepare("UPDATE organizations SET trial_ends_at = 0 WHERE id = 'org-demo'").run()
    assert.equal((await owner(`bookings/${future.id}`, 'PATCH', { status: 'canceled', version: 1 })).status, 200)
    assert.equal((await owner(`bookings/${future.id}`, 'PATCH', { status: 'confirmed', version: 2 })).status, 402)
    assert.equal((await owner('booking-change-policy', 'PUT', { hours: 1 })).status, 402)
    assert.equal((await (await owner(`bookings?date=${day(4)}`)).json()).bookings[0].status, 'canceled')
    await db.prepare('UPDATE bookings SET management_expires_at = 0 WHERE id = ?').bind(booking.id).run()
    assert.equal((await manage()).status, 404)
    const exported = await (await owner('export')).json()
    assert.equal(JSON.stringify(exported).includes(token), false)
    assert.equal(JSON.stringify(exported).includes('management_token_hash'), false)
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
})
