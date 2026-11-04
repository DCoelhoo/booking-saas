import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile,mkdtemp,rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Miniflare,convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo,demoCookie } from './account-fixture.mjs'
import { applySql } from './apply-sql.mjs'
import { calendarDocument } from '../worker/calendar.ts'
import { businessNow,businessTimestamp } from '../worker/businessTime.ts'

test('calendar subscriptions remain personal, reflect changes and reject revoked or inactive access',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'booking-calendar-'))
 const options=convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/index.js',compatibilityDate:'2026-10-19',d1Databases:{booking_saas_db:'calendar-db'}})
 options.resourcePersistencePath=directory
 let runtime=new Miniflare(options)
 const req=(path,method='GET',body,cookie=demoCookie,headers={})=>runtime.dispatchFetch(`http://localhost/api/${path}`,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})
 const day=(offset)=>businessNow(new Date(Date.now()+offset*86400000)).slice(0,10)
 const subscription=(cookie=demoCookie)=>req('me/calendar','POST',{confirm_private_link:true},cookie)
 try{
  let db=await runtime.getD1Database('booking_saas_db')
  await applySql(db,await readFile('migrations/0001_initial_schema.sql','utf8'))
  await db.prepare("INSERT INTO organizations(id,name,slug) VALUES ('org-demo','Demo','demo'),('other','Outro','outro')").run()
  await authenticateDemo(db)
  await db.prepare("INSERT INTO services(id,organization_id,name,duration_minutes,price_cents) VALUES ('service','org-demo','Consulta',30,1000),('foreign','other','Serviço secreto',30,1000)").run()
  await db.prepare("INSERT INTO staff_members(id,organization_id,name) VALUES ('ana','org-demo','Ana')").run()
  await db.prepare("INSERT INTO users(id,organization_id,email,full_name,password_hash,role,staff_id) VALUES ('ana-user','org-demo','ana@example.test','Ana','not-used','staff','ana')").run()
  const staffCookie=`booking_session=${'b'.repeat(43)}`
  await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,'ana-user',?)").bind(createHash('sha256').update('b'.repeat(43)).digest('hex'),Date.now()+86400000).run()
  for(const [id,org,staff,service,name] of [['owner-booking','org-demo','staff:org-demo','service','Cliente do dono'],['ana-booking','org-demo','ana','service','Cliente da Ana'],['private','other','staff:other','foreign','Segredo de outro negócio']]){
   await db.prepare('INSERT INTO bookings(id,organization_id,staff_id,service_id,customer_name,customer_email,customer_phone,start_at,end_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id,org,staff,service,name,'private-contact@example.test','+351900000000',`${day(3)}T10:00:00`,`${day(3)}T10:30:00`).run()
  }
  assert.equal((await req('me/calendar','GET',undefined,'')).status,401)
  assert.equal((await req('me/calendar','POST',{})).status,400)
  assert.equal((await req('me/calendar','POST',{confirm_private_link:true},demoCookie,{Origin:'https://other.test'})).status,403)
  assert.equal((await(await req('me/calendar')).json()).active,false)
  const generated=await subscription()
  assert.equal(generated.status,201)
  const link=await generated.json(),path=new URL(link.url).pathname
  assert.equal(new URL(link.url).origin,'http://localhost')
  const token=path.match(/([\w-]{43})\.ics$/)[1]
  assert.notEqual((await db.prepare("SELECT token_hash FROM calendar_subscriptions WHERE user_id='fixture-user'").first()).token_hash,token)
  const status=await(await req('me/calendar')).json()
  assert.equal(status.active,true);assert.equal(JSON.stringify(status).includes(token),false)
  let response=await runtime.dispatchFetch(link.url)
  assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/^text\/calendar/)
  assert.equal(response.headers.get('Cache-Control'),'no-store')
  const unfold=s=>s.replace(/\r\n /g,'')
  let content=unfold(await response.text())
  assert.ok(content.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(content.includes('Cliente do dono'));assert.equal(content.includes('Cliente da Ana'),false)
  assert.equal(content.includes('Segredo de outro'),false);assert.equal(content.includes('private-contact'),false);assert.equal(content.includes('900000000'),false)
  const expected=new Date(businessTimestamp(`${day(3)}T10:00:00`)).toISOString().replace(/[-:]/g,'').slice(0,15)+'Z'
  assert.ok(content.includes(`DTSTART:${expected}`))
  const uid=content.match(/UID:([^\r]+)/)[1]
  // Same UID, new dates and sequence after rescheduling.
  await db.prepare("UPDATE bookings SET start_at=?,end_at=?,version=2 WHERE id='owner-booking'").bind(`${day(4)}T11:00:00`,`${day(4)}T11:30:00`).run()
  content=unfold(await(await runtime.dispatchFetch(link.url)).text())
  assert.ok(content.includes(`UID:${uid}`));assert.ok(content.includes('SEQUENCE:1'))
  await req('bookings/owner-booking','PATCH',{status:'canceled',version:2})
  content=unfold(await(await runtime.dispatchFetch(link.url)).text())
  assert.ok(content.includes('STATUS:CANCELLED'));assert.ok(content.includes('TRANSP:TRANSPARENT'));assert.ok(content.includes('SEQUENCE:2'))
  const anaLink=await(await subscription(staffCookie)).json()
  const anaContent=unfold(await(await runtime.dispatchFetch(anaLink.url)).text())
  assert.ok(anaContent.includes('Cliente da Ana'));assert.equal(anaContent.includes('Cliente do dono'),false)
  assert.equal((await req('me/calendar','GET',undefined,staffCookie)).status,200)
  // Trial expiry does not remove access to existing personal subscriptions.
  await db.prepare("UPDATE organizations SET trial_ends_at=0 WHERE id='org-demo'").run()
  assert.equal((await runtime.dispatchFetch(link.url)).status,200)
  const rotated=await(await subscription()).json()
  assert.notEqual(rotated.url,link.url);assert.equal((await runtime.dispatchFetch(link.url)).status,404)
  await runtime.dispose();runtime=new Miniflare(options);db=await runtime.getD1Database('booking_saas_db')
  assert.equal((await runtime.dispatchFetch(rotated.url)).status,200)
  const head=await runtime.dispatchFetch(rotated.url,{method:'HEAD'})
  assert.equal(head.status,200);assert.equal(await head.text(),'')
  assert.equal((await req('me/calendar','DELETE')).status,200)
  assert.equal((await runtime.dispatchFetch(rotated.url)).status,404)
  const insecure=await runtime.dispatchFetch('http://calendar-preview.example/api/me/calendar',{method:'POST',headers:{Cookie:demoCookie,'Content-Type':'application/json'},body:JSON.stringify({confirm_private_link:true})})
  assert.equal(insecure.status,503,'non-local links must use HTTPS')
  const secure=await runtime.dispatchFetch('https://calendar-preview.example/api/me/calendar',{method:'POST',headers:{Cookie:demoCookie.replace('booking_session=','__Host-booking_session='),'Content-Type':'application/json'},body:JSON.stringify({confirm_private_link:true})})
  assert.equal(secure.status,201)
  assert.equal(new URL((await secure.json()).url).origin,'https://calendar-preview.example')
  await db.prepare("UPDATE organizations SET trial_ends_at=? WHERE id='org-demo'").bind(Date.now()+86400000).run()
  assert.equal((await req('staff/ana','PATCH',{name:'Ana',is_active:0})).status,200)
  assert.equal((await runtime.dispatchFetch(anaLink.url)).status,404)
  await req('staff/ana','PATCH',{name:'Ana',is_active:1})
  assert.equal((await runtime.dispatchFetch(anaLink.url)).status,404,'reactivation never restores old calendar secrets')
 }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true})}
})

test('iCalendar text escapes injection and folds UTF-8 lines without splitting characters',()=>{
 const document=calendarDocument('Agenda Áéç'.repeat(20),[{id:'test',version:1,status:'confirmed',customer_name:'Nome, teste; \\ fim\r\nBEGIN:VEVENT',service_name:'Serviço com acentos '.repeat(15),start_at:'2027-03-28T10:00:00',end_at:'2027-03-28T10:30:00',modified_at:'2026-11-04 10:00:00'}])
 for(const line of document.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75)
 assert.equal(document.includes('\ufffd'),false)
 const unfolded=document.replace(/\r\n /g,'')
 assert.equal(unfolded.match(/\r\nBEGIN:VEVENT\r\n/g).length,1)
 assert.ok(unfolded.includes('Nome\\, teste\\; \\\\ fim\\nBEGIN:VEVENT'))
 assert.ok(unfolded.includes('DTSTART:20270328T090000Z'))
 assert.ok(unfolded.includes('DTEND:20270328T093000Z'))
})
