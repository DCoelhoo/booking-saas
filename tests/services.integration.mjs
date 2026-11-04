import { authenticateDemo, demoCookie } from './account-fixture.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('services retain edits and state in local D1 across runtime restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-services-'))
  const options = convertV4MiniflareOptions({
    modules: true,
    scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19',
    d1Databases: { booking_saas_db: 'services-integration' },
  })
  options.resourcePersistencePath = directory
  let runtime = new Miniflare(options)
  async function request(path, method = 'GET', body) {
    return runtime.dispatchFetch(`http://localhost/api/services${path}`, {
      method, headers: { Cookie: demoCookie },
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json', Cookie: demoCookie }, body: JSON.stringify(body),
      }),
    })
  }
  try {
    const db = await runtime.getD1Database('booking_saas_db')
    const schema = await readFile('migrations/0001_initial_schema.sql', 'utf8')
    for (const statement of schema.split(';').filter((part) => part.trim())) {
      await db.prepare(statement).run()
    }
    await db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-demo', 'Demo', 'demo'), ('other', 'Other', 'other')").run()
    await authenticateDemo(db)
    await db.prepare("INSERT INTO services (id, organization_id, name, duration_minutes, price_cents) VALUES ('other-service', 'other', 'Private', 30, 1000)").run()
    const created = await request('', 'POST', { name: 'Original', duration_minutes: 30, price_cents: 1000 })
    assert.equal(created.status, 201)
    const { id } = await created.json()
    await db.prepare("INSERT INTO bookings (id, organization_id, service_id, customer_name, start_at, end_at) VALUES ('history', 'org-demo', ?, 'Cliente', '2026-11-04T10:00:00Z', '2026-11-04T10:30:00Z')").bind(id).run()
    const edited = await request(`/${id}`, 'PATCH', { name: ' Atualizado ', duration_minutes: 45, price_cents: 1250 })
    assert.equal(edited.status, 200)
    assert.deepEqual(await edited.json(), { id, name: 'Atualizado', duration_minutes: 45, price_cents: 1250, is_active: 1 })
    assert.equal((await request(`/${id}`, 'PATCH', { is_active: 0 })).status, 200)
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE id = 'history'").first()).count, 1)
    for (const invalid of [{}, { name: ' ' }, { duration_minutes: 0 }, { price_cents: -1 }, { is_active: true }, { organization_id: 'other' }]) {
      assert.equal((await request(`/${id}`, 'PATCH', invalid)).status, 400)
    }
    assert.equal((await request('/other-service', 'PATCH', { name: 'Changed' })).status, 404)
    assert.equal((await request('/missing', 'PATCH', { is_active: 0 })).status, 404)
    await runtime.dispose()
    runtime = new Miniflare(options)
    const { services } = await (await request('')).json()
    assert.deepEqual(services, [{ id, name: 'Atualizado', duration_minutes: 45, price_cents: 1250, is_active: 0 }])
    const reactivated = await request(`/${id}`, 'PATCH', { is_active: 1 })
    assert.equal(reactivated.status, 200)
    assert.equal((await reactivated.json()).is_active, 1)
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
