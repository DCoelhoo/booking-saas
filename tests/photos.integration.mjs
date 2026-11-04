import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile,mkdtemp,rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Miniflare,convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo,demoCookie } from './account-fixture.mjs'
import { applySql } from './apply-sql.mjs'

test('profile photos persist in R2, remain scoped to their owner and disappear after replacement or removal',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'booking-photos-'))
 const options=convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/index.js',compatibilityDate:'2026-10-19',d1Databases:{booking_saas_db:'photo-db'},r2Buckets:{PROFILE_PHOTOS:'photos'}})
 options.resourcePersistencePath=directory
 let runtime=new Miniflare(options)
 const request=(path,method='GET',body,cookie=demoCookie,headers={})=>runtime.dispatchFetch(`http://localhost/api/${path}`,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})
 const photo=await readFile('tests/fixtures/profile.jpg')
 const image=photo.toString('base64')
 try{
  let db=await runtime.getD1Database('booking_saas_db')
  await applySql(db,await readFile('migrations/0001_initial_schema.sql','utf8'))
  await db.prepare("INSERT INTO organizations(id,name,slug) VALUES ('org-demo','Demo','demo'),('other','Other','other')").run()
  await authenticateDemo(db)
  await db.prepare("INSERT INTO staff_members(id,organization_id,name) VALUES ('ana','org-demo','Ana')").run()
  await db.prepare("INSERT INTO users(id,organization_id,email,full_name,password_hash,role,staff_id) VALUES ('ana-user','org-demo','ana@example.test','Ana','not-used','staff','ana')").run()
  const staffToken='b'.repeat(43),staffCookie=`booking_session=${staffToken}`
  await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,'ana-user',?)").bind(createHash('sha256').update(staffToken).digest('hex'),Date.now()+86400000).run()
  assert.equal((await request('me/photo','POST',{image},'')).status,401)
  assert.equal((await request('me/photo','POST',{image},demoCookie,{Origin:'https://other.test'})).status,403)
  for(const invalid of ['not-base64',Buffer.from('<svg onload="bad()"/>').toString('base64'),Buffer.alloc(256*1024+1).toString('base64')]) assert.equal((await request('me/photo','POST',{image:invalid})).status,400)
  assert.equal((await request('me/photo','POST',{image},demoCookie,{'Content-Type':'image/jpeg'})).status,415)
  const uploaded=await request('me/photo','POST',{image,staff_id:'ana'})
  assert.equal(uploaded.status,200,await uploaded.clone().text())
  const owner=await uploaded.json(),url=owner.user.photo_url
  assert.match(url,/^\/api\/staff-photos\/[\w-]+\.jpg$/)
  assert.equal((await db.prepare("SELECT photo_key FROM staff_members WHERE id='ana'").first()).photo_key,'','target IDs cannot replace somebody else’s photo')
  const fetched=await runtime.dispatchFetch('http://localhost'+url)
  assert.equal(fetched.status,200);assert.equal(fetched.headers.get('Content-Type'),'image/jpeg');assert.equal(fetched.headers.get('X-Content-Type-Options'),'nosniff')
  assert.deepEqual(Buffer.from(await fetched.arrayBuffer()),photo)
  const publicData=await(await request('public/demo','GET',undefined,'')).json()
  assert.equal(publicData.staff.find(m=>m.id==='staff:org-demo').photo_url,url)
  assert.equal(JSON.stringify(publicData).includes('photo_key'),false)
  const own=await request('me/photo','POST',{image,staff_id:'staff:other'},staffCookie)
  assert.equal(own.status,200)
  const anaUrl=(await own.json()).user.photo_url
  assert.notEqual(anaUrl,url)
  assert.equal((await db.prepare("SELECT photo_key FROM staff_members WHERE id='staff:other'").first()).photo_key,'')
  assert.equal((await request('staff/ana','PATCH',{name:'Ana',is_active:0})).status,200)
  assert.equal((await runtime.dispatchFetch('http://localhost'+anaUrl)).status,404)
  assert.equal((await runtime.dispatchFetch('http://localhost'+anaUrl,{headers:{Cookie:demoCookie}})).status,200)
  assert.equal((await request('me/photo','DELETE',undefined,staffCookie)).status,401)
  // Retain read/write account controls even after the business trial ends.
  await db.prepare("UPDATE organizations SET trial_ends_at=0 WHERE id='org-demo'").run()
  const replacement=await request('me/photo','POST',{image})
  assert.equal(replacement.status,200)
  const replacementUrl=(await replacement.json()).user.photo_url
  assert.notEqual(replacementUrl,url)
  assert.equal((await runtime.dispatchFetch('http://localhost'+url)).status,404)
  await runtime.dispose();runtime=new Miniflare(options)
  db=await runtime.getD1Database('booking_saas_db')
  assert.equal((await runtime.dispatchFetch('http://localhost'+replacementUrl)).status,200)
  assert.equal((await(await request('auth/session')).json()).user.photo_url,replacementUrl)
  const removed=await request('me/photo','DELETE')
  assert.equal(removed.status,200);assert.equal((await removed.json()).user.photo_url,'')
  assert.equal((await runtime.dispatchFetch('http://localhost'+replacementUrl)).status,404)
  const bucket=await runtime.getR2Bucket('PROFILE_PHOTOS')
  assert.equal((await bucket.list()).objects.length,1,'only the other user’s photo remains')
 }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true})}
})
