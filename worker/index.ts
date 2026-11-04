import type { D1Database } from '@cloudflare/workers-types'
import { authenticate, checkMutation, handleAuth } from './auth.ts'
import { updateProfile } from './profile.ts'
import { subscriptionRequired } from './subscriptions.ts'
import { exportData } from './export.ts'
import { handleBookings } from './bookings.ts'
import { businessNow, conflictCondition, previewDuration, projection, projectionValues, snapshot } from './serviceDuration.ts'

interface Env {
  booking_saas_db: D1Database
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return Response.json({ status: 'ok', application: 'booking-saas' })
    const invalidMutation = checkMutation(request)
    if (invalidMutation) return invalidMutation
    const authResponse = await handleAuth(request, env.booking_saas_db)
    if (authResponse) return authResponse
    const account = await authenticate(request, env.booking_saas_db)
    if (!account) return Response.json({ error: 'Inicia sessão para continuar.' }, { status: 401 })
    const organizationId = account.organization.id
    if (url.pathname === '/api/subscription' && request.method === 'GET') return Response.json(account.subscription)
    if (url.pathname === '/api/export' && request.method === 'GET') return exportData(env.booking_saas_db, account)
    const managesServices = url.pathname.startsWith('/api/services') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)
    const managesBookings = url.pathname.startsWith('/api/bookings') && ['POST', 'PATCH', 'PUT'].includes(request.method)
    if (!account.subscription.can_manage && (managesServices || managesBookings)) return subscriptionRequired()
    if (url.pathname === '/api/profile' && request.method === 'PATCH') {
      return updateProfile(request, env.booking_saas_db, account)
    }
    const previewMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/duration-preview$/)
    if (previewMatch && request.method === 'POST') {
      return previewDuration(request, env.booking_saas_db, previewMatch[1], organizationId)
    }
    const bookingsResponse = await handleBookings(request, env.booking_saas_db, organizationId)
    if (bookingsResponse) return bookingsResponse

    if (url.pathname === '/api/services' && request.method === 'GET') {

      try {
        const { results } = await env.booking_saas_db
          .prepare(`
            SELECT
              id,
              name,
              duration_minutes,
              price_cents,
              is_active
            FROM services
            WHERE organization_id = ?
            ORDER BY name
          `)
          .bind(organizationId)
          .all()

        return Response.json({ services: results })
      } catch (error) {
        console.error('Erro ao consultar serviços:', error)

        return Response.json(
          { error: 'Não foi possível carregar os serviços.' },
          { status: 500 }
        )
      }
    }


    if (url.pathname === '/api/services' && request.method === 'POST') {
      try {
        const body: unknown = await request.json()

        if (
          typeof body !== 'object' ||
          body === null ||
          !('name' in body) ||
          !('duration_minutes' in body) ||
          !('price_cents' in body)
        ) {
          return Response.json(
            { error: 'Dados inválidos.' },
            { status: 400 }
          )
        }

        const { name, duration_minutes, price_cents } = body

        if (
          typeof name !== 'string' ||
          !name.trim() ||
          name.trim().length > 100 ||
          typeof duration_minutes !== 'number' ||
          !Number.isInteger(duration_minutes) ||
          duration_minutes <= 0 ||
          typeof price_cents !== 'number' ||
          !Number.isSafeInteger(price_cents) ||
          price_cents < 0
        ) {
          return Response.json(
            { error: 'Nome, duração ou preço inválidos.' },
            { status: 400 }
          )
        }

        const id = crypto.randomUUID()

        await env.booking_saas_db
          .prepare(`
        INSERT INTO services (
          id,
          organization_id,
          name,
          duration_minutes,
          price_cents
        )
        VALUES (?, ?, ?, ?, ?)
      `)
          .bind(
            id,
            organizationId,
            name.trim(),
            duration_minutes,
            price_cents
          )
          .run()

        return Response.json(
          {
            id,
            name: name.trim(),
            duration_minutes,
            price_cents,
            is_active: 1,
          },
          { status: 201 }
        )
      } catch (error) {
        console.error('Erro ao criar serviço:', error)

        return Response.json(
          { error: 'Não foi possível criar o serviço.' },
          { status: 500 }
        )
      }
    }


    const serviceMatch = url.pathname.match(/^\/api\/services\/([^/]+)$/)

    if (serviceMatch && request.method === 'PATCH') {
      let body: unknown

      try {
        body = await request.json()
      } catch {
        return Response.json({ error: 'JSON inválido.' }, { status: 400 })
      }

      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return Response.json({ error: 'Dados inválidos.' }, { status: 400 })
      }

      const updates: string[] = []
      const values: (string | number)[] = []
      const allowedFields = ['name', 'duration_minutes', 'price_cents', 'is_active', 'apply_to_future_bookings', 'bookings_snapshot']

      if (Object.keys(body).some((key) => !allowedFields.includes(key))) {
        return Response.json({ error: 'Campos não permitidos.' }, { status: 400 })
      }

      for (const [key, value] of Object.entries(body)) {
        if (key === 'apply_to_future_bookings' || key === 'bookings_snapshot') continue
        const valid = key === 'name'
          ? typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100
          : key === 'is_active'
            ? value === 0 || value === 1
            : typeof value === 'number' && Number.isSafeInteger(value) &&
              (key === 'duration_minutes' ? value > 0 : value >= 0)

        if (!valid) {
          return Response.json({ error: `Valor inválido para ${key}.` }, { status: 400 })
        }

        updates.push(`${key} = ?`)
        values.push(typeof value === 'string' ? value.trim() : value as number)
      }

      if (updates.length === 0) {
        return Response.json({ error: 'Indica pelo menos um campo para atualizar.' }, { status: 400 })
      }

      try {
        const options = body as Record<string, unknown>
        if (options.apply_to_future_bookings !== undefined && typeof options.apply_to_future_bookings !== 'boolean') {
          return Response.json({ error: 'Opção inválida.' }, { status: 400 })
        }
        if (options.apply_to_future_bookings === true) {
          if (typeof options.duration_minutes !== 'number' || typeof options.bookings_snapshot !== 'string') {
            return Response.json({ error: 'Verifica as marcações antes de confirmar.' }, { status: 400 })
          }
          const id = serviceMatch[1]
          const now = businessNow()
          const db = env.booking_saas_db
          if (!await db.prepare('SELECT id FROM services WHERE id = ? AND organization_id = ?').bind(id, organizationId).first()) {
            return Response.json({ error: 'Serviço não encontrado.' }, { status: 404 })
          }
          // D1 batches run transactionally. The first statement guards the whole update;
          // changes() lets the second statement proceed only when the guard succeeded.
          const [updated] = await db.batch([
            db.prepare(`${projection} UPDATE services SET ${updates.join(', ')}
              WHERE id = ? AND organization_id = ?
                AND ${snapshot} = ? AND NOT ${conflictCondition}
              RETURNING id, name, duration_minutes, price_cents, is_active`)
              .bind(...projectionValues(id, now, options.duration_minutes, organizationId), ...values, id, organizationId, options.bookings_snapshot),
            db.prepare(`UPDATE bookings
              SET end_at = strftime('%Y-%m-%dT%H:%M:%S', start_at, '+' || ? || ' minutes')
              WHERE changes() = 1 AND organization_id = ? AND service_id = ?
                AND julianday(start_at) > julianday(?)`)
              .bind(options.duration_minutes, organizationId, id, now),
          ])
          if (!updated.results.length) {
            return Response.json({ error: 'Existem conflitos ou a agenda mudou. Verifica novamente antes de confirmar.' }, { status: 409 })
          }
          return Response.json(updated.results[0])
        }
        const service = await env.booking_saas_db
          .prepare(`
            UPDATE services
            SET ${updates.join(', ')}
            WHERE id = ? AND organization_id = ?
            RETURNING id, name, duration_minutes, price_cents, is_active
          `)
          .bind(...values, serviceMatch[1], organizationId)
          .first()

        if (!service) {
          return Response.json({ error: 'Serviço não encontrado.' }, { status: 404 })
        }

        return Response.json(service)
      } catch (error) {
        console.error('Erro ao atualizar serviço:', error)
        return Response.json({ error: 'Não foi possível atualizar o serviço.' }, { status: 500 })
      }
    }

    return Response.json(
      { error: 'Endpoint não encontrado' },
      { status: 404 }
    )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await handleRequest(request, env)
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('X-Content-Type-Options', 'nosniff')
      return response
    } catch (error) {
      console.error('Erro no pedido:', error)
      return Response.json({ error: 'Não foi possível concluir o pedido.' }, {
        status: 500, headers: { 'Cache-Control': 'no-store' },
      })
    }
  },
}
