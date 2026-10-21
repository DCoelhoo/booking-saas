import type { D1Database } from '@cloudflare/workers-types'

interface Env {
  booking_saas_db: D1Database
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return Response.json({
        status: 'ok',
        application: 'booking-saas',
      })
    }

    if (url.pathname === '/api/services' && request.method === 'GET') {
      const organizationId = 'org-demo'

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
            'org-demo',
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


    return Response.json(
      { error: 'Endpoint não encontrado' },
      { status: 404 }
    )
  },
} 
