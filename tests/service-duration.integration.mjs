import { authenticateDemo, demoCookie } from './account-fixture.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('future durations require review and update atomically without changing history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-duration-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'duration-integration' } })
  options.resourcePersistencePath = directory
  const runtime = new Miniflare(options)
  async function request(path, method, body) {
    return runtime.dispatchFetch(`http://localhost/api/services/${path}`, {
      method, headers: { 'Content-Type': 'application/json', Cookie: demoCookie }, body: JSON.stringify(body),
    })
  }
  const preview = (duration) => request('service/duration-preview', 'POST', { duration_minutes: duration })
  const apply = (duration, snapshot) => request('service', 'PATCH', {
    name: 'Atualizado', duration_minutes: duration, apply_to_future_bookings: true, bookings_snapshot: snapshot,
  })
  try {
    const db = await runtime.getD1Database('booking_saas_db')
    const schema = await readFile('migrations/0001_initial_schema.sql', 'utf8')
    for (const statement of schema.split(';').filter((part) => part.trim())) await db.prepare(statement).run()
    await db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-demo', 'Demo', 'demo'), ('other', 'Other', 'other')").run()
    await authenticateDemo(db)
    await db.prepare("INSERT INTO services (id, organization_id, name, duration_minutes, price_cents) VALUES ('service', 'org-demo', 'Original', 30, 1000), ('second', 'org-demo', 'Outro', 30, 1000), ('foreign', 'other', 'Privado', 30, 1000)").run()
    async function booking(id, service, start, end, organization = 'org-demo') {
      await db.prepare('INSERT INTO bookings (id, organization_id, service_id, customer_name, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, organization, service, 'Cliente', start, end).run()
    }
    await booking('past', 'service', '2000-01-01T10:00:00', '2000-01-01T10:30:00')
    await booking('future', 'service', '2090-01-01T10:00:00', '2090-01-01T10:30:00')
    await booking('adjacent', 'service', '2090-01-01T11:00:00', '2090-01-01T11:30:00')
    await booking('private', 'foreign', '2090-01-01T10:00:00', '2090-01-01T12:00:00', 'other')
    assert.equal((await request('foreign/duration-preview', 'POST', { duration_minutes: 60 })).status, 404)
    for (const duration of [0, -1, 1.5, '60']) assert.equal((await preview(duration)).status, 400)
    assert.equal((await apply(60, undefined)).status, 400)
    let review = await (await preview(60)).json()
    assert.equal(review.has_conflicts, false)
    assert.equal(review.bookings.length, 2)
    assert.equal(review.bookings[0].proposed_end, '2090-01-01T11:00:00')
    assert.equal((await apply(60, review.snapshot)).status, 200)
    assert.equal((await db.prepare("SELECT end_at FROM bookings WHERE id = 'future'").first()).end_at, '2090-01-01T11:00:00')
    assert.equal((await db.prepare("SELECT end_at FROM bookings WHERE id = 'adjacent'").first()).end_at, '2090-01-01T12:00:00')
    assert.equal((await db.prepare("SELECT end_at FROM bookings WHERE id = 'past'").first()).end_at, '2000-01-01T10:30:00')
    review = await (await preview(90)).json()
    assert.equal(review.has_conflicts, true)
    assert.equal((await apply(90, review.snapshot)).status, 409)
    assert.equal((await db.prepare("SELECT duration_minutes FROM services WHERE id = 'service'").first()).duration_minutes, 60)
    review = await (await preview(30)).json()
    await booking('new', 'service', '2090-01-02T10:00:00', '2090-01-02T11:00:00')
    assert.equal((await apply(30, review.snapshot)).status, 409)
    review = await (await preview(30)).json()
    // A different service can introduce a conflict after preview; apply must recheck.
    await booking('blocker', 'second', '2090-01-01T10:15:00', '2090-01-01T10:45:00')
    assert.equal((await apply(30, review.snapshot)).status, 409)
    await db.prepare("DELETE FROM bookings WHERE id = 'blocker'").run()
    review = await (await preview(30)).json()
    assert.equal((await apply(30, review.snapshot)).status, 200)
    assert.equal((await db.prepare("SELECT end_at FROM bookings WHERE id = 'new'").first()).end_at, '2090-01-02T10:30:00')
    await booking('late', 'service', '2090-01-03T17:30:00', '2090-01-03T18:00:00')
    review = await (await preview(60)).json()
    assert.equal(review.has_conflicts, true)
    assert.equal((await apply(60, review.snapshot)).status, 409)
    // Default editing still preserves existing booking durations.
    assert.equal((await request('service', 'PATCH', { duration_minutes: 90 })).status, 200)
    assert.equal((await db.prepare("SELECT end_at FROM bookings WHERE id = 'late'").first()).end_at, '2090-01-03T18:00:00')
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
