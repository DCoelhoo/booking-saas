import { useRef, useState, type ChangeEvent } from 'react'
import { secureFetch, type Account } from './accountApi'
import Avatar from './Avatar'

async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('Escolhe uma imagem JPG, PNG ou WebP até 10 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw Error('A imagem é demasiado grande. Escolhe uma fotografia mais pequena.')
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context) throw Error('Não foi possível preparar a fotografia neste browser.')
    context.fillStyle = '#ffffff'; context.fillRect(0,0,512,512)
    const side = Math.min(bitmap.width,bitmap.height)
    context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,512,512)
    const data = canvas.toDataURL('image/jpeg',0.85).split(',')[1]
    if (data.length > 349_528) throw Error('A fotografia continua demasiado grande. Escolhe outra imagem.')
    return data
  } finally { bitmap.close() }
}

export default function ProfilePhoto({ account, onChange }: { account:Account; onChange:(account:Account)=>void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  async function change(method:'POST'|'DELETE', file?:File) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const image = file ? await preparePhoto(file) : undefined
      const response = await secureFetch('/api/me/photo',{ method,...(image ? { headers:{'Content-Type':'application/json'},body:JSON.stringify({image}) } : {}) })
      const result = await response.json()
      if (!response.ok) throw Error(result.error || 'Não foi possível guardar a fotografia.')
      onChange(result)
      setNotice(method === 'DELETE' ? 'Fotografia removida.' : 'Fotografia guardada.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a fotografia.') }
    finally { setBusy(false); if(input.current) input.current.value='' }
  }
  function select(event:ChangeEvent<HTMLInputElement>) { const file=event.target.files?.[0]; if(file) void change('POST',file) }
  return <section className="panel profile-photo-panel" aria-label="A tua fotografia">
    <div><h2>A tua fotografia</h2><p>Aparece na tua conta e na escolha de colaborador na página pública do estabelecimento.</p></div>
    <div className="profile-photo-actions"><Avatar name={account.user.full_name} src={account.user.photo_url} size="large" />
      <div><label htmlFor="profile-photo-file">Escolher fotografia</label><input id="profile-photo-file" ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={select} />
        <small>JPG, PNG ou WebP até 10 MB. Recorte quadrado automático.</small>
        {account.user.photo_url && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void change('DELETE')}>Remover fotografia</button>}
      </div>
    </div>
    {busy && <p role="status">A guardar fotografia...</p>}{error && <p className="booking-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>
}
