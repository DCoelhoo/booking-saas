import './LandingPage.css'

const features = [
  ['01', 'Um link. Mais marcações.', 'Partilha a página do teu estabelecimento. O cliente escolhe o colaborador, o serviço e o horário, sem criar conta.'],
  ['02', 'Uma equipa, agendas próprias.', 'Até 5 perfis, incluindo o dono. Cada colaborador acede à sua agenda e tu acompanhas o estabelecimento inteiro.'],
  ['03', 'Menos trocas de mensagens.', 'O cliente pode cancelar ou reagendar pelo link privado da reserva, dentro do prazo que definires.'],
]

function AgendaPreview() {
  return <div className="home-preview" aria-label="Exemplo ilustrativo de uma agenda">
    <div className="home-preview-top"><span><i /> O teu espaço</span><span className="home-preview-tag">Exemplo de agenda</span></div>
    <div className="home-preview-body"><div className="home-preview-sidebar"><b>Agenda</b><span>Serviços</span><span>Colaboradores</span><span>Faturas</span></div>
      <div className="home-preview-calendar"><div className="home-calendar-heading"><div><small>A TUA EQUIPA, NUM SÓ LUGAR</small><h3>Um dia bem organizado.</h3></div><span>↗</span></div>
        <div className="home-calendar-columns"><span />{['Ana', 'Miguel', 'Inês'].map((name, i) => <strong key={name}><i className={`home-avatar home-avatar-${i}`}>{name[0]}</i>{name}</strong>)}</div>
        <div className="home-calendar-grid"><div className="home-calendar-times"><span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span></div>
          <div><div className="home-appointment home-appointment-blue"><small>09:00 – 09:45</small><b>Consulta inicial</b><span>Com Ana</span></div><div className="home-appointment home-appointment-green home-appointment-later"><small>11:00 – 11:30</small><b>Acompanhamento</b><span>Com Ana</span></div></div>
          <div><div className="home-appointment home-appointment-sand home-appointment-offset"><small>10:00 – 11:00</small><b>Sessão individual</b><span>Com Miguel</span></div></div>
          <div><div className="home-appointment home-appointment-green"><small>09:00 – 09:30</small><b>Atendimento</b><span>Com Inês</span></div></div>
        </div>
      </div></div>
    <div className="home-preview-bottom"><span><i /> Cada marcação no seu lugar.</span><span>Um exemplo do teu próximo dia →</span></div>
  </div>
}

export default function LandingPage() {
  return <div className="home-page">
    <a className="home-skip" href="#conteudo">Saltar para o conteúdo</a>
    <header className="home-header"><a className="home-brand" href="/" aria-label="Giro: início"><span>G</span>Giro</a>
      <nav aria-label="Navegação principal"><a href="#como-funciona">Como funciona</a><a href="#funcionalidades">Funcionalidades</a><a href="#preco">Preço</a></nav>
      <div className="home-header-actions"><a className="home-login" href="/conta">Entrar</a><a className="home-button home-button-small" href="/conta?criar=1">Experimentar <span aria-hidden="true">↗</span></a></div>
    </header>
    <main id="conteudo">
      <section className="home-hero"><div className="home-hero-copy"><p className="home-eyebrow"><span /> MAIS TEMPO PARA O TEU NEGÓCIO</p>
        <h1>A tua agenda.<br />A tua equipa.<br /><em>Tudo no seu lugar.</em></h1>
        <p className="home-hero-description">Recebe marcações online e organiza o dia de cada colaborador. Um espaço simples para quem marca. Uma visão clara para quem gere.</p>
        <div className="home-hero-actions"><a className="home-button" href="/conta?criar=1">Começar os meus 14 dias <span aria-hidden="true">↗</span></a><a className="home-text-link" href="#como-funciona">Conhecer a aplicação <span aria-hidden="true">↓</span></a></div>
        <p className="home-trial-note"><span aria-hidden="true">✓</span> 14 dias de teste <span>·</span> Sem cartão <span>·</span> Sem cobranças automáticas no teste</p>
      </div><div className="home-hero-aside"><span className="home-aside-number">01 / ORGANIZAR</span><p>Menos tempo a combinar.<br /><strong>Mais tempo a atender.</strong></p><div className="home-aside-symbol" aria-hidden="true">✳</div></div>
      </section>
      <section className="home-product" aria-label="Pré-visualização da aplicação"><AgendaPreview /><p>Para estabelecimentos com serviços por marcação: de um profissional a uma equipa.</p></section>
      <section className="home-features home-section" id="funcionalidades"><div className="home-section-heading"><p className="home-eyebrow">FEITO PARA O TEU DIA A DIA</p><h2>Do primeiro clique<br />ao próximo atendimento.</h2></div>
        <div className="home-feature-grid">{features.map(([n,title,text])=><article key={n}><span className="home-feature-number">{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
        <div className="home-feature-strip"><span>Horários, pausas e encerramentos</span><span>Serviços, duração e preços</span><span>Histórico de marcações</span><span>Identidade do estabelecimento</span></div>
      </section>
      <section className="home-how home-section" id="como-funciona"><div><p className="home-eyebrow">COMEÇAR É SIMPLES</p><h2>O teu negócio,<br />pronto para marcar.</h2><p>Configura uma vez. Partilha o teu link.<br />Acompanha cada marcação na agenda certa.</p><a className="home-text-link" href="/conta?criar=1">Criar a minha conta <span aria-hidden="true">↗</span></a></div>
        <ol>{[['Cria o teu espaço','Personaliza o nome, a cor e os contactos do estabelecimento.'],['Prepara os serviços e a equipa','Define preços, durações e horários. Convida os teus colaboradores.'],['Partilha e recebe marcações','O cliente escolhe com quem quer marcar e encontra os horários disponíveis.']].map(([title,text],i)=><li key={title}><span>{String(i+1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>
      </section>
      <section className="home-pricing home-section" id="preco"><div><p className="home-eyebrow">UM PLANO, SEM COMPLICAÇÕES</p><h2>Um preço simples.<br />Espaço para a tua equipa.</h2><p>Experimenta antes de decidires.<br />Os primeiros 14 dias são por nossa conta.</p></div><article className="home-price-card"><div className="home-price-card-top"><strong>O teu estabelecimento</strong><span>14 dias de teste</span></div><p className="home-price"><strong>10 €</strong><span>/ mês</span></p><p>por estabelecimento, após o período de teste</p><ul><li>Página pública com link próprio</li><li>Até 5 perfis, incluindo o dono</li><li>Agendas individuais e gestão de serviços</li><li>Cancelamento e reagendamento pelo cliente</li></ul><a className="home-button" href="/conta?criar=1">Experimentar sem cartão <span aria-hidden="true">↗</span></a><small>A cobrança da subscrição ainda não está ativa. O teste não gera cobranças automáticas.</small></article></section>
      <section className="home-faq home-section"><div><p className="home-eyebrow">AINDA COM DÚVIDAS?</p><h2>O essencial,<br />sem letras pequenas.</h2></div><div>{[
        ['Os meus clientes precisam de criar conta?','Não. Através do link do estabelecimento, escolhem colaborador, serviço e horário e deixam os contactos necessários para a marcação.'],
        ['Cada colaborador tem o seu acesso?','Sim. O dono envia um convite e cada colaborador acede apenas à sua agenda. O dono pode acompanhar todas as agendas do estabelecimento.'],
        ['Posso definir pausas e dias de encerramento?','Sim. As marcações respeitam os períodos de funcionamento, pausas e encerramentos configurados para o estabelecimento. Nesta versão, os horários são partilhados pela equipa.'],
        ['Já posso cobrar os serviços pela aplicação?','Por enquanto, as reservas públicas aceitam pagamento no local e serviços gratuitos. As cobranças online aguardam a integração de pagamentos.'],
      ].map(([q,a])=><details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
      <section className="home-final"><p className="home-eyebrow">O PRÓXIMO PASSO É TEU</p><h2>Abre espaço para<br />um dia mais simples.</h2><a className="home-button" href="/conta?criar=1">Criar o meu estabelecimento <span aria-hidden="true">↗</span></a></section>
    </main>
    <footer className="home-footer"><a className="home-brand" href="/"><span>G</span>Giro</a><p>O teu negócio. Bem organizado.</p><a href="/conta">Aceder à minha conta ↗</a></footer>
  </div>
}
