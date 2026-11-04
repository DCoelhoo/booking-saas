import { createHash,randomBytes } from 'node:crypto'
import type { D1Database } from '@cloudflare/workers-types'
import { appUrl,type EmailEnv } from './email.ts'
import { jsonBody,rateLimit,type Account } from './auth.ts'
import { businessNow,businessTimestamp } from './businessTime.ts'

const digest=(token:string)=>createHash('sha256').update(token).digest('hex')
const text=(value:string)=>Array.from(value).filter(character=>{
  const code=character.codePointAt(0)!
  return (code>=32&&code!==127)||code===9||code===10||code===13
}).join('').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,')
const stamp=(value:number)=>new Date(value).toISOString().replace(/[-:]/g,'').slice(0,15)+'Z'
function fold(line:string):string {
  let result='',length=0
  for(const character of line){
    const code=character.codePointAt(0)!
    const bytes=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4
    if(length+bytes>75){result+='\r\n ';length=1}
    result+=character;length+=bytes
  }
  return result
}
type Event = { id:string; version:number; status:string; customer_name:string; service_name:string; start_at:string; end_at:string; modified_at:string }

export function calendarDocument(name:string,events:Event[]):string {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Giro//Agenda//PT','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${text(name)}`,'X-WR-TIMEZONE:Europe/Lisbon']
  for(const event of events){
    const start=businessTimestamp(event.start_at),end=businessTimestamp(event.end_at)
    if(start===null||end===null||end<=start)continue
    const modified=Date.parse(event.modified_at.replace(' ','T')+'Z')
    const status=event.status==='canceled'?'CANCELLED':'CONFIRMED'
    const label=({confirmed:'Confirmada',completed:'Concluída',canceled:'Cancelada',no_show:'Não compareceu'} as Record<string,string>)[event.status] || 'Confirmada'
    lines.push('BEGIN:VEVENT',`UID:${digest(event.id)}@booking-saas`, `DTSTAMP:${stamp(Number.isFinite(modified)?modified:0)}`,`SEQUENCE:${Math.max(0,event.version-1)}`,
      `DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`STATUS:${status}`,`TRANSP:${status==='CANCELLED'?'TRANSPARENT':'OPAQUE'}`,'CLASS:PRIVATE',
      `SUMMARY:${text(`${event.status==='canceled'?'Cancelada: ':''}${event.service_name} · ${event.customer_name}`)}`,
      `DESCRIPTION:${text(`Estado: ${label}. Gere esta marcação na aplicação Giro.`)}`,'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n')+'\r\n'
}

export async function calendarFeed(request:Request,db:D1Database):Promise<Response|null>{
  const path=new URL(request.url).pathname
  if(!path.startsWith('/api/calendar-feed/'))return null
  const match=path.match(/^\/api\/calendar-feed\/([A-Za-z0-9_-]{43})\.ics$/)
  if(!match||!['GET','HEAD'].includes(request.method))return Response.json({error:'Calendário não encontrado.'},{status:404})
  const user=await db.prepare(`SELECT u.id,u.staff_id,u.organization_id,u.full_name,o.name FROM calendar_subscriptions c JOIN users u ON u.id=c.user_id
    JOIN organizations o ON o.id=u.organization_id JOIN staff_members m ON m.id=u.staff_id AND m.organization_id=u.organization_id
    WHERE c.token_hash=? AND (u.role='owner' OR m.is_active=1)`).bind(digest(match[1])).first<{id:string;staff_id:string;organization_id:string;full_name:string;name:string}>()
  if(!user)return Response.json({error:'Calendário não encontrado.'},{status:404})
  const now=Date.now(),from=businessNow(new Date(now-90*86400000)).slice(0,10),to=businessNow(new Date(now+366*86400000)).slice(0,10)
  const {results}=await db.prepare(`SELECT b.id,b.version,b.status,b.customer_name,COALESCE(b.service_name_snapshot,s.name) AS service_name,b.start_at,b.end_at,
    COALESCE((SELECT MAX(e.created_at) FROM booking_events e WHERE e.booking_id=b.id),b.created_at) AS modified_at
    FROM bookings b JOIN services s ON s.id=b.service_id AND s.organization_id=b.organization_id
    WHERE b.organization_id=? AND b.staff_id=? AND b.start_at>=? AND b.start_at<? ORDER BY b.start_at,b.id`)
    .bind(user.organization_id,user.staff_id,from,to).all<Event>()
  return new Response(request.method==='HEAD'?null:calendarDocument(`${user.name}: ${user.full_name}`,results),{headers:{
    'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="agenda.ics"','X-Robots-Tag':'noindex, nofollow, noarchive',
  }})
}

export async function calendarSettings(request:Request,env:EmailEnv,account:Account):Promise<Response|null>{
  if(new URL(request.url).pathname!=='/api/me/calendar')return null
  const db=env.booking_saas_db
  if(request.method==='GET'){
    const row=await db.prepare('SELECT created_at FROM calendar_subscriptions WHERE user_id=?').bind(account.user.id).first()
    return Response.json({active:!!row,created_at:row?.created_at||null})
  }
  if(request.method==='DELETE'){
    await db.prepare('DELETE FROM calendar_subscriptions WHERE user_id=?').bind(account.user.id).run()
    return Response.json({active:false})
  }
  if(request.method!=='POST')return Response.json({error:'Método não permitido.'},{status:405})
  const body=await jsonBody(request)
  if(!body||body.confirm_private_link!==true)return Response.json({error:'Confirma a criação de um link privado para a tua agenda.'},{status:400})
  if(!await rateLimit(db,`calendar:${account.user.id}`,10))return Response.json({error:'Demasiados pedidos. Tenta novamente mais tarde.'},{status:429})
  const origin=new URL(request.url)
  const local=['localhost','127.0.0.1','[::1]'].includes(origin.hostname)
  let base:string
  try { base=appUrl({...env,APP_URL:local?origin.origin:env.APP_URL||origin.origin}) }
  catch { return Response.json({error:'Configura um endereço HTTPS público para disponibilizar a agenda.'},{status:503}) }
  if(!local&&(new URL(base).protocol!=='https:'||['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)))return Response.json({error:'Configura um endereço HTTPS público para disponibilizar a agenda.'},{status:503})
  const token=randomBytes(32).toString('base64url')
  await db.prepare(`INSERT INTO calendar_subscriptions(user_id,token_hash) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=CURRENT_TIMESTAMP`)
    .bind(account.user.id,digest(token)).run()
  const url=`${base}/api/calendar-feed/${token}.ics`
  return Response.json({active:true,url,created_at:new Date().toISOString()},{status:201})
}
