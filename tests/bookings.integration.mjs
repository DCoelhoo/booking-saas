import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('agenda persists bookings, rejects conflicts and respects service availability', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-agenda-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'agenda-integration' } })
  options.resourcePersistencePath = directory
  let runtime = new Miniflare(options)
  async function request(path, method = 'GET', body) {
    return runtime.dispatchFetch(`http://localhost/api/${path}`, { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  }
  const input = { customer_name: ' Cliente ', service_id: 'service', date: '2026-11-05', start_time: '10:00' }
  try {
    const db = await runtime.getD1Database('booking_saas_db')
    const schema = await readFile('migrations/0001_initial_schema.sql', 'utf8')
    for (const statement of schema.split(';').filter((part) => part.trim())) await db.prepare(statement).run()
    await db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-demo', 'Demo', 'demo'), ('other', 'Other', 'other')").run()
    await db.prepare("INSERT INTO services (id, organization_id, name, duration_minutes, price_cents, is_active) VALUES ('service', 'org-demo', 'Consulta', 30, 1000, 1), ('inactive', 'org-demo', 'Inativo', 30, 1000, 0), ('foreign', 'other', 'Privado', 30, 1000, 1)").run()
    for (const invalid of [{ date: '2026-02-30' }, { start_time: '25:00' }, { start_time: '08:59' },
      { start_time: '17:31' }, { customer_name: ' ' }, { service_id: 'inactive' }, { service_id: 'foreign' }, { service_id: 'missing' }]) {
      assert.equal((await request('bookings', 'POST', { ...input, ...invalid })).status, 400)
    }
    assert.equal((await request('bookings?date=invalid')).status, 400)
    const concurrent = await Promise.all([request('bookings', 'POST', input), request('bookings', 'POST', input)])
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409])
    const booking = await concurrent.find((r) => r.status === 201).json()
    assert.equal(booking.customer_name, 'Cliente')
    assert.equal(booking.end_at, '2026-11-05T10:30:00')
    for (const start_time of ['09:45', '10:15']) {
      assert.equal((await request('bookings', 'POST', { ...input, start_time })).status, 409)
    }
    assert.equal((await request('bookings', 'POST', { ...input, start_time: '10:30' })).status, 201)
    assert.equal((await request('bookings', 'POST', { ...input, start_time: '17:30' })).status, 201)
    assert.equal((await request('bookings', 'POST', { ...input, date: '2026-11-06' })).status, 201)
    await request('services/service', 'PATCH', { duration_minutes: 60, is_active: 0 })
    assert.equal((await request('bookings', 'POST', { ...input, start_time: '14:00' })).status, 400)
    await db.prepare("INSERT INTO bookings (id, organization_id, service_id, customer_name, start_at, end_at) VALUES ('private', 'other', 'foreign', 'Privado', '2026-11-05T10:00:00', '2026-11-05T11:00:00')").run()
    assert.equal((await request('bookings/private', 'DELETE')).status, 404)
    await runtime.dispose()
    runtime = new Miniflare(options)
    const list = await request('bookings?date=2026-11-05')
    assert.equal(list.status, 200)
    const { bookings } = await list.json()
    assert.equal(bookings.length, 3)
    assert.equal(bookings[0].end_at, '2026-11-05T10:30:00')
    assert.equal(bookings[0].service_name, 'Consulta')
    assert.equal((await request(`bookings/${booking.id}`, 'DELETE')).status, 204)
    await runtime.dispose()
    runtime = new Miniflare(options)
    assert.equal((await (await request('bookings?date=2026-11-05')).json()).bookings.length, 2)
    assert.equal((await request(`bookings/${booking.id}`, 'DELETE')).status, 404)
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
