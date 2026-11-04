import { useEffect,useState } from 'react'
import { accountRequest } from './accountApi'
import './CalendarSettings.css'

type Link = { url:string }
export default function CalendarSettings() {
  const [active,setActive]=useState<boolean|null>(null)
  const [link,setLink]=useState<Link|null>(null)
  const [confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [retry,setRetry]=useState(0)
  const local=['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)
  useEffect(()=>{
    let canceled=false
    accountRequest<{active:boolean}>('me/calendar').then(data=>{if(!canceled){setActive(data.active);setError('')}}).catch((e:Error)=>{if(!canceled)setError(e.message)})
    return()=>{canceled=true}
  },[retry])
  async function create(){
    if(busy||!confirmed)return
    if(active&&!window.confirm('Criar um novo link invalida o anterior. Terás de voltar a adicionar o calendário no Google e/ou Apple. Continuar?'))return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await accountRequest<Link>('me/calendar','POST',{confirm_private_link:true})
      setLink(result);setActive(true);setConfirmed(false);setNotice('Link criado. Copia-o agora para adicionar a tua agenda.')
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível criar o link.')}
    finally{setBusy(false)}
  }
  async function revoke(){
    if(busy||!window.confirm('Desativar este link? O Google e a Apple deixam de receber atualizações. Remove também a subscrição nesses serviços.'))return
    setBusy(true);setError('');setNotice('')
    try{await accountRequest('me/calendar','DELETE');setActive(false);setLink(null);setNotice('Link desativado. Remove a subscrição no Google/Apple para apagar as cópias do calendário.')}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível desativar.')}
    finally{setBusy(false)}
  }
  return <section className="panel calendar-settings" aria-label="Google Calendar e Apple iCloud">
    <h2>Google Calendar e Apple/iCloud</h2>
    <p>Consulta as tuas marcações no teu calendário pessoal através de uma subscrição. Mostra apenas a tua agenda, incluindo para o dono do estabelecimento.</p>
    <p>É uma ligação de leitura: cria, altera ou cancela as marcações nesta aplicação. Não importa compromissos pessoais nem bloqueia horários com base neles.</p>
    <p>As atualizações dependem da frequência de sincronização do Google ou da Apple e podem demorar. Inclui os últimos 90 dias e os próximos 365 dias.</p>
    {local&&<p className="calendar-local-note">Estás em desenvolvimento local. Podes testar o link aqui, mas o Google e a Apple precisam de um endereço HTTPS público para o consultar.</p>}
    {active===null?<><p role="status">A carregar ligação...</p>{error&&<button type="button" className="secondary-button" onClick={()=>setRetry(n=>n+1)}>Tentar novamente</button>}</>:<>
      <p><strong>{active?'Subscrição disponível':'Sem link de calendário ativo'}</strong></p>
      {active&&!link&&<p>Por segurança, o link só é mostrado quando é criado. Se já adicionaste a subscrição, ela continua ativa. Se precisas de outro link, cria um novo e volta a adicionar o calendário.</p>}
      <label className="calendar-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>Quero criar um link privado para a minha agenda. Quem tiver o link poderá consultar os serviços, horários e nomes dos clientes.</span></label>
      <div className="calendar-actions"><button type="button" className="primary-button" disabled={busy||!confirmed} onClick={()=>void create()}>{active?'Criar novo link':'Criar link privado'}</button>
        {active&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void revoke()}>Desativar link</button>}
      </div>
    </>}
    {link&&<div className="calendar-link-box"><label htmlFor="calendar-private-link">Link privado da tua agenda</label><input id="calendar-private-link" value={link.url} readOnly onFocus={e=>e.target.select()} />
      <button type="button" className="secondary-button" onClick={()=>{void navigator.clipboard.writeText(link.url).then(()=>setNotice('Link copiado.')).catch(()=>setError('Não foi possível copiar. Seleciona o endereço acima e copia-o manualmente.'))}}>Copiar link</button>
      <p>Guarda este endereço em privado. Não o partilhes na página pública do estabelecimento.</p>
    </div>}
    <div className="calendar-guides"><details><summary>Adicionar ao Google Calendar</summary><ol><li>Num computador, abre o Google Calendar.</li><li>Em «Outros calendários», escolhe a opção para adicionar um calendário a partir de um URL.</li><li>Cola o link privado e adiciona o calendário.</li></ol><a href="https://calendar.google.com/calendar/r/settings/addbyurl" target="_blank" rel="noopener noreferrer">Abrir Google Calendar ↗</a><p>Adiciona uma subscrição pelo endereço, em vez de importar um ficheiro uma única vez.</p></details>
      <details><summary>Adicionar ao Calendário Apple/iCloud</summary><p>No iPhone/iPad, abre Calendário, entra em Calendários e adiciona uma subscrição de calendário. No Mac, usa Ficheiro → Nova subscrição de calendário.</p><p>Cola o link privado e escolhe a conta/localização iCloud para o disponibilizar nos teus dispositivos. A configuração é feita na aplicação Calendário da Apple.</p></details>
    </div>
    {error&&<p className="booking-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>
}
