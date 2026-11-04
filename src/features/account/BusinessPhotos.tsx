import { useState, type CSSProperties } from 'react'
import { secureFetch, type Account } from './accountApi'
import { preparePhoto } from './preparePhoto'
import './BusinessPhotos.css'

export default function BusinessPhotos({account,onChange,brandColor}:{account:Account;onChange:(account:Account)=>void;brandColor:string}) {
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  async function change(kind:'cover'|'profile',file?:File) {
    if(busy) return
    setBusy(true);setError('');setNotice('')
    try {
      const image=file ? await preparePhoto(file,kind==='cover') : undefined
      const response=await secureFetch(`/api/business/photos/${kind}`,{method:file?'POST':'DELETE',...(image?{headers:{'Content-Type':'application/json'},body:JSON.stringify({image})}:{})})
      const result=await response.json()
      if(!response.ok) throw Error(result.error || 'Não foi possível guardar a imagem.')
      onChange(result);setNotice(file?'Imagem guardada.':'Imagem removida.')
    } catch(cause) {setError(cause instanceof Error?cause.message:'Não foi possível guardar a imagem.')}
    finally {setBusy(false)}
  }
  return <section className="panel business-photos" aria-label="Imagens do estabelecimento">
    <h2>Imagens do estabelecimento</h2><p>Personaliza a capa e a fotografia circular da tua página de marcações.</p>
    <div className="business-photo-preview" style={{'--public-brand':brandColor} as CSSProperties}><div className="business-cover-preview">{account.organization.cover_url && <img src={account.organization.cover_url} alt="Capa do estabelecimento" />}</div>
      <div className="business-avatar-preview">{(account.organization.profile_photo_url)?<img src={account.organization.profile_photo_url} alt="Fotografia do estabelecimento" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.hidden=true}} />:<span>{account.organization.name.slice(0,1)}</span>}</div>
    </div>
    {(['cover','profile'] as const).map(kind=><div className="business-photo-control" key={kind}>
      <label htmlFor={`business-photo-${kind}`}>{kind==='cover'?'Fotografia de capa (opcional)':'Fotografia de perfil do estabelecimento'}</label>
      <input id={`business-photo-${kind}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !account.subscription.can_manage} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file) void change(kind,file)}} />
      <small>JPG, PNG ou WebP até 10 MB. Recorte central automático {kind==='cover'?'horizontal (64:25).':'quadrado.'}</small>
      {account.organization[kind==='cover'?'cover_url':'profile_photo_url'] && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void change(kind)}>Remover {kind==='cover'?'capa':'fotografia do estabelecimento'}</button>}
    </div>)}
    {!account.subscription.can_manage && <p>A personalização requer uma subscrição ativa.</p>}
    {busy && <p role="status">A guardar imagem...</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="booking-error">{error}</p>}
  </section>
}
