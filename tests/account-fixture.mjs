import { applySql } from './apply-sql.mjs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const demoCookie = `booking_session=${'a'.repeat(43)}`

export async function authenticateDemo(db) {
  for (const file of ['0002_accounts.sql', '0003_subscription_trials.sql', '0004_availability.sql', '0005_email_notifications.sql', '0006_booking_payment_settings.sql', '0007_public_bookings.sql', '0008_booking_lifecycle.sql', '0009_booking_reminders.sql', '0010_staff.sql', '0011_profile_photos.sql', '0012_calendar_subscriptions.sql']) {
    const migration = await readFile(`migrations/${file}`, 'utf8')
    await applySql(db,migration)
  }
  await db.prepare("INSERT INTO users (id, organization_id, email, full_name, password_hash) VALUES ('fixture-user', 'org-demo', 'fixture@example.com', 'Fixture', 'not-used-for-login')").run()
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(createHash('sha256').update('a'.repeat(43)).digest('hex'), 'fixture-user', Date.now() + 3_600_000).run()
}
