import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile,mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import { Miniflare,convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo,demoCookie } from './account-fixture.mjs'
import { applySql } from './apply-sql.mjs'
import { businessNow } from '../worker/businessTime.ts'

test('staff invitations, account isolation, parallel agendas and the ten-member limit are enforced',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'staff-integration-'))
 const options=convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/index.js',compatibilityDate:'2026-10-19',d1Databases:{booking_saas_db:'staff'},bindings:{EMAIL_MODE:'preview',APP_URL:'http://localhost'}})
 options.resourcePersistencePath=dir
 const runtime=new Miniflare(options)
 const req=(path,method='GET',body,cookie=demoCookie)=>runtime.dispatchFetch(`http://localhost/api/${path}`,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
 try{
  const db=await runtime.getD1Database('booking_saas_db')
  await applySql(db,await readFile('migrations/0001_initial_schema.sql','utf8'))
  await db.prepare("INSERT INTO organizations(id,name,slug) VALUES ('org-demo','Demo','demo'),('other','Other','other')").run()
  await authenticateDemo(db)
  await db.prepare("INSERT INTO services(id,organization_id,name,duration_minutes,price_cents) VALUES ('service','org-demo','Consulta',30,1000)").run()
  await db.prepare("UPDATE organizations SET availability=? WHERE id='org-demo'").bind(JSON.stringify({weekly:Array.from({length:7},()=>[{start:'09:00',end:'18:00'}]),closures:[]})).run()
  const invite=await req('staff','POST',{name:'Ana',email:'ana@example.test'})
  assert.equal(invite.status,201,await invite.clone().text())
  const {id:ana}=await invite.json()
  const readToken=async(email)=>{const r=await db.prepare("SELECT payload FROM email_outbox WHERE kind='staff_invitation' AND json_extract(payload,'$.to')=? ORDER BY rowid DESC LIMIT 1").bind(email).first();return JSON.parse(r.payload).text.match(/staff-invitation=([\w-]+)/)[1]}
  const token=await readToken('ana@example.test')
  assert.equal((await db.prepare('SELECT token_hash FROM staff_invitations WHERE staff_id=?').bind(ana).first()).token_hash.includes(token),false)
  await req(`staff/${ana}`,'POST',{email:'ana@example.test'})
  const latest=await readToken('ana@example.test')
  assert.equal((await req('auth/invitation/accept','POST',{token,new_password:'uma password de colaborador'},'')).status,400)
  const accepted=await Promise.all([req('auth/invitation/accept','POST',{token:latest,new_password:'uma password de colaborador'},''),req('auth/invitation/accept','POST',{token:latest,new_password:'uma password de colaborador'},'')])
  assert.deepEqual(accepted.map(r=>r.status).sort(),[200,400])
  const login=await req('auth/login','POST',{email:'ana@example.test',password:'uma password de colaborador'},'')
  assert.equal(login.status,200)
  const cookie=login.headers.get('Set-Cookie').split(';')[0],account=await login.json()
  assert.equal(account.user.role,'staff');assert.equal(account.user.staff_id,ana)
  assert.equal((await req('staff','GET',undefined,cookie)).status,200)
  assert.equal((await (await req('staff','GET',undefined,cookie)).json()).staff.length,1)
  for(const path of ['export','email-previews','profile','booking-change-policy']) assert.equal((await req(path,'GET',undefined,cookie)).status,403)
  assert.equal((await req('staff','POST',{name:'Intruso',email:'bad@example.test'},cookie)).status,403)
  assert.equal((await req('services','POST',{name:'bad',duration_minutes:30,price_cents:1},cookie)).status,403)
  await req('auth/password/reset','POST',{email:'fixture@example.com'},'')
  await req('auth/password/reset','POST',{email:'ana@example.test'},'')
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE kind='password_reset_request' AND payload IS NOT NULL AND status='preview'").first()).n,2,'recovery messages remain scoped to each user')
  const date=new Date(Date.parse(`${businessNow().slice(0,10)}T12:00:00Z`)+3*86400000).toISOString().slice(0,10)
  const input={service_id:'service',customer_name:'Cliente',customer_email:'client@example.test',customer_phone:'',date,start_time:'10:00',expected_price_cents:1000,expected_duration_minutes:30}
  const book=(staff_id,extra={})=>req('public/demo/bookings','POST',{...input,staff_id,request_id:randomUUID(),...extra},'')
  const parallel=await Promise.all([book('staff:org-demo',{customer_name:'Privado do dono'}),book(ana)])
  assert.deepEqual(parallel.map(r=>r.status),[201,201])
  const ownerBooking=(await parallel[0].json()).booking,anaBooking=(await parallel[1].json()).booking
  const own=(await(await req(`bookings?date=${date}&staff_id=staff:org-demo`,'GET',undefined,cookie)).json()).bookings
  assert.equal(own.length,1);assert.equal(own[0].id,anaBooking.id)
  assert.equal(JSON.stringify(own).includes('Privado do dono'),false)
  assert.equal((await req(`bookings/${ownerBooking.id}`,'PATCH',{status:'canceled',version:1},cookie)).status,404)
  assert.equal((await req('bookings','POST',{customer_name:'X',service_id:'service',staff_id:'staff:org-demo',date,start_time:'11:00'},cookie)).status,403)
  assert.equal((await book('staff:other')).status,409)
  assert.equal((await req(`public/demo/slots?date=${date}&service_id=service&staff_id=staff:other`,'GET',undefined,'')).status,404)
  const same=await Promise.all([book(ana,{start_time:'11:00',customer_email:'x@example.test'}),book(ana,{start_time:'11:00',customer_email:'y@example.test'})])
  assert.deepEqual(same.map(r=>r.status).sort(),[201,409])
  // Different staff can overlap even when a service duration is reviewed.
  const review=await req('services/service/duration-preview','POST',{duration_minutes:30})
  assert.equal(review.status,200);assert.equal((await review.json()).has_conflicts,false)
  assert.equal((await req(`staff/${ana}`,'PATCH',{name:'Ana',is_active:0})).status,200)
  assert.equal((await req('auth/session','GET',undefined,cookie)).status,401)
  assert.equal((await book(ana,{start_time:'14:00',customer_email:'z@example.test'})).status,409)
  assert.equal((await req(`staff/${ana}`,'PATCH',{name:'Ana',is_active:1})).status,200)
  assert.equal((await req('auth/session','GET',undefined,cookie)).status,401,'old sessions stay revoked after reactivation')
  // Capacity includes inactive profiles and the initial owner profile. Concurrent creation cannot exceed it.
  for(let i=0;i<7;i++) assert.equal((await req('staff','POST',{name:`Pessoa ${i}`,email:`person-${i}@example.test`})).status,201)
  const capacity=await Promise.all([req('staff','POST',{name:'Final A',email:'a@example.test'}),req('staff','POST',{name:'Final B',email:'b@example.test'})])
  assert.deepEqual(capacity.map(r=>r.status).sort(),[201,409])
  assert.equal((await(await req('staff')).json()).staff.length,10)
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE kind='booking_created'").first()).n,3,'owner notifications are not duplicated per staff user')
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE kind='booking_assigned'").first()).n,2)
 }finally{await runtime.dispose();await rm(dir,{recursive:true,force:true})}
})

test('staff migration retains existing sessions, recovery tokens and booking history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'staff-migration-'))
 const options=convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/index.js',compatibilityDate:'2026-10-19',d1Databases:{booking_saas_db:'migration'}});options.resourcePersistencePath=dir
 const runtime=new Miniflare(options)
 try{
  const db=await runtime.getD1Database('booking_saas_db')
  for(const name of ['0001_initial_schema.sql','0002_accounts.sql','0003_subscription_trials.sql','0004_availability.sql','0005_email_notifications.sql','0006_booking_payment_settings.sql','0007_public_bookings.sql','0008_booking_lifecycle.sql','0009_booking_reminders.sql'])await applySql(db,await readFile(`migrations/${name}`,'utf8'))
  await db.prepare("INSERT INTO organizations(id,name,slug) VALUES ('org','Original','original')").run()
  await db.prepare("INSERT INTO users(id,organization_id,email,full_name,password_hash) VALUES ('user','org','original@example.test','Dono original','original-password-hash')").run()
  const token='p'.repeat(43),hash=createHash('sha256').update(token).digest('hex')
  await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,'user',?)").bind(hash,Date.now()+86400000).run()
  await db.prepare("INSERT INTO password_change_tokens(token_hash,user_id,password_hash_at_request,expires_at) VALUES ('reset','user','original-password-hash',?)").bind(Date.now()+86400000).run()
  await db.prepare("INSERT INTO services(id,organization_id,name,duration_minutes,price_cents) VALUES ('s','org','Serviço',30,1000)").run()
  await db.prepare("INSERT INTO bookings(id,organization_id,service_id,customer_name,start_at,end_at) VALUES ('b','org','s','Cliente antigo','2090-01-01T10:00:00','2090-01-01T10:30:00')").run()
  await applySql(db,await readFile('migrations/0010_staff.sql','utf8'))
  await applySql(db,await readFile('migrations/0011_profile_photos.sql','utf8'))
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0)
  assert.equal((await db.prepare("SELECT staff_id FROM bookings WHERE id='b'").first()).staff_id,'staff:org')
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM password_change_tokens').first()).n,1)
  const session=await runtime.dispatchFetch('http://localhost/api/auth/session',{headers:{Cookie:`booking_session=${token}`}})
  assert.equal(session.status,200);assert.equal((await session.json()).user.role,'owner')
 }finally{await runtime.dispose();await rm(dir,{recursive:true,force:true})}
})
