import { Buffer } from 'node:buffer'
import type { R2Bucket } from '@cloudflare/workers-types'
import { authenticate, getAccount, rateLimit, type Account } from './auth.ts'
import type { EmailEnv } from './email.ts'

export interface PhotoEnv extends EmailEnv { PROFILE_PHOTOS?: R2Bucket }
const maximumBytes = 256 * 1024
const unavailable = () => Response.json({ error: 'O armazenamento de fotografias ainda não está disponível.' }, { status: 503 })

async function readImage(request: Request): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return null
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 350_000) { await reader.cancel(); return null }
    chunks.push(value)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof body?.image === 'string' ? body.image : null
  } catch { return null }
}

// Accept raster JPEGs with bounded dimensions. SVG and user-controlled MIME types are never served.
function validJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || bytes.length > maximumBytes || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false
  let offset = 2
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) return false
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 218 || marker === 217) return false
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return false
    if ([192, 193, 194].includes(marker)) {
      if (length < 8) return false
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
      return height > 0 && height <= 1024 && width > 0 && width <= 1024
    }
    offset += length
  }
  return false
}

export async function publicPhoto(request: Request, env: PhotoEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith('/api/staff-photos/')) return null
  const match = path.match(/^\/api\/staff-photos\/([0-9a-f-]{36})\.jpg$/)
  if (!match || request.method !== 'GET') return Response.json({ error: 'Fotografia não encontrada.' }, { status: 404 })
  const member = await env.booking_saas_db.prepare('SELECT id,organization_id,is_active FROM staff_members WHERE photo_key=?').bind(match[1]).first<{ id:string; organization_id:string; is_active:number }>()
  if (!member) return Response.json({ error: 'Fotografia não encontrada.' }, { status: 404 })
  if (!member.is_active) {
    const account = await authenticate(request,env.booking_saas_db)
    if (!account || account.organization.id !== member.organization_id || (account.user.role !== 'owner' && account.user.staff_id !== member.id)) return Response.json({ error: 'Fotografia não encontrada.' }, { status: 404 })
  }
  const object = await env.PROFILE_PHOTOS?.get(`profiles/${match[1]}.jpg`)
  if (!object) return Response.json({ error: 'Fotografia não encontrada.' }, { status: 404 })
  return new Response(object.body, { headers: { 'Content-Type':'image/jpeg', 'Content-Length':String(object.size), 'X-Content-Type-Options':'nosniff', 'Content-Disposition':'inline; filename="perfil.jpg"' } })
}

export async function myPhoto(request: Request, env: PhotoEnv, account: Account): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/me/photo') return null
  if (!['POST','DELETE'].includes(request.method)) return Response.json({ error: 'Método não permitido.' }, { status: 405 })
  if (!await rateLimit(env.booking_saas_db,`photo:${account.user.id}`,20)) return Response.json({ error: 'Demasiadas alterações. Tenta novamente mais tarde.' }, { status: 429 })
  const member = await env.booking_saas_db.prepare('SELECT photo_key FROM staff_members WHERE id=? AND organization_id=?')
    .bind(account.user.staff_id,account.organization.id).first<{ photo_key:string }>()
  if (!member) return Response.json({ error: 'Perfil não encontrado.' }, { status: 404 })
  let key = ''
  if (request.method === 'POST') {
    const image = await readImage(request)
    if (!image || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length % 4 !== 0) return Response.json({ error: 'Fotografia inválida ou demasiado grande.' }, { status: 400 })
    const bytes = Buffer.from(image,'base64')
    if (!validJpeg(bytes)) return Response.json({ error: 'Envia uma fotografia JPEG até 256 KB e 1024 píxeis.' }, { status: 400 })
    if (!env.PROFILE_PHOTOS) return unavailable()
    key = crypto.randomUUID()
    await env.PROFILE_PHOTOS.put(`profiles/${key}.jpg`,bytes,{ httpMetadata:{ contentType:'image/jpeg' } })
  }
  try {
    const updated = await env.booking_saas_db.prepare('UPDATE staff_members SET photo_key=? WHERE id=? AND organization_id=? AND photo_key=? RETURNING id')
      .bind(key,account.user.staff_id,account.organization.id,member.photo_key).first()
    if (!updated) {
      if (key) await env.PROFILE_PHOTOS?.delete(`profiles/${key}.jpg`)
      return Response.json({ error:'A fotografia mudou entretanto. Atualiza a página e tenta novamente.' },{ status:409 })
    }
  } catch (error) {
    if (key) await env.PROFILE_PHOTOS?.delete(`profiles/${key}.jpg`).catch(()=>undefined)
    throw error
  }
  // An old object can never be fetched once its reference has been replaced or removed.
  if (member.photo_key) await env.PROFILE_PHOTOS?.delete(`profiles/${member.photo_key}.jpg`).catch(()=>undefined)
  return Response.json(await getAccount(env.booking_saas_db,account.user.id))
}
