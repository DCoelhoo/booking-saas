import { useEffect, useRef, useState } from 'react'
import { previewUpdateEvent, previewUpdateStorageKey } from '../public/previewUpdates'
import './PagePreview.css'

export default function PagePreview({ slug, onEdit }: { slug:string; onEdit:()=>void }) {
  const [device,setDevice] = useState<'mobile'|'desktop'>('mobile')
  const [revision,setRevision] = useState(0)
  const [availableWidth,setAvailableWidth] = useState(320)
  const [loading,setLoading] = useState(true)
  const measure = useRef<HTMLDivElement>(null)
  const width = device === 'mobile' ? 390 : 1280
  const height = device === 'mobile' ? 844 : 820
  const scale = Math.min(1,Math.max(1,availableWidth-20)/width)

  useEffect(()=>{
    const observer = new ResizeObserver(([entry])=>setAvailableWidth(entry.contentRect.width))
    if (measure.current) observer.observe(measure.current)
    return ()=>observer.disconnect()
  },[])
  useEffect(()=>{
    const update = ()=>{ setLoading(true); setRevision(n=>n+1) }
    const storage = (event:StorageEvent)=>{ if(event.key===previewUpdateStorageKey) update() }
    const visible = ()=>{ if(document.visibilityState==='visible') update() }
    window.addEventListener(previewUpdateEvent,update)
    window.addEventListener('storage',storage)
    document.addEventListener('visibilitychange',visible)
    return ()=>{
      window.removeEventListener(previewUpdateEvent,update)
      window.removeEventListener('storage',storage)
      document.removeEventListener('visibilitychange',visible)
    }
  },[])

  return <section className="page-preview">
    <div className="panel preview-intro"><div><h2>A tua página, vista pelos clientes</h2>
      <p>Experimenta os formatos de telemóvel e computador com os dados guardados do estabelecimento.</p></div>
      <button type="button" className="secondary-button" onClick={onEdit}>Personalizar página</button>
    </div>
    <div className="preview-toolbar">
      <div className="preview-device-options" role="group" aria-label="Formato da pré-visualização">
        <button type="button" aria-pressed={device==='mobile'} onClick={()=>setDevice('mobile')}>Telemóvel <small>390 px</small></button>
        <button type="button" aria-pressed={device==='desktop'} onClick={()=>setDevice('desktop')}>Computador <small>1280 px</small></button>
      </div>
      <div className="preview-actions"><button type="button" className="secondary-button" onClick={()=>{setLoading(true);setRevision(n=>n+1)}}>Atualizar</button>
        <a href={`/${slug}`} target="_blank" rel="noopener noreferrer">Abrir página pública ↗</a>
      </div>
    </div>
    <p className="preview-note">Mostra as alterações guardadas no estabelecimento. Podes explorar a página sem enviar marcações.</p>
    <div className="preview-stage"><div className="preview-measure" ref={measure}>
      <div className={`preview-device preview-device-${device}`}>
        <div className="preview-device-bar"><span aria-hidden="true">{device==='mobile'?'●':'● ● ●'}</span><span>/{slug}</span><span aria-hidden="true">↗</span></div>
        <div className="preview-viewport" style={{width:width*scale,height:height*scale}}>
          <iframe key={`${slug}:${revision}`} title={`Pré-visualização da página pública em ${device==='mobile'?'telemóvel':'computador'}`} src={`/${encodeURIComponent(slug)}?preview=1`}
            width={width} height={height} style={{width,height,transform:`scale(${scale})`}} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" onLoad={()=>setLoading(false)} />
        </div>
      </div>
    </div></div>
    <p className="preview-status" role="status">{loading?'A carregar pré-visualização...':`${device==='mobile'?'Telemóvel':'Computador'}: ${width} × ${height} px${scale<1?' · Vista reduzida para caber no ecrã':''}`}</p>
  </section>
}
