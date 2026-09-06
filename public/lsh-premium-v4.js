
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>[...document.querySelectorAll(s)];
let cfg = null;

function waLink(number, text){
  const n = String(number||'').replace(/\D/g,'');
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
async function loadConfig(){
  try{
    const r = await fetch('/api/config');
    cfg = await r.json();

    const mainMessage='Olá! Vim pelo site da LSH Studio RB e gostaria de falar com vocês. 💗';
    const mainLink=waLink(cfg.whatsapp, mainMessage);

    const targets = [
      '#whatsappFloat','#heroWhatsappBtn','#topWhatsappBtn','#mobileWhatsappBtn',
      '#whatsappLink'
    ];
    targets.forEach(sel=>{ const el=$(sel); if(el) el.href=mainLink; });

    const contactBtn = $('#contactWhatsappBtn');
    if(contactBtn) contactBtn.href = mainLink;

    const errorBtn = $('#errorWhatsapp');
    if(errorBtn) errorBtn.href = waLink(cfg.whatsapp,'Olá! Tive um problema ao tentar realizar meu agendamento pelo site da LSH Studio RB. Poderia me ajudar?');

    const cW = $('#contactWhatsapp'); if(cW) cW.textContent = cfg.whatsapp || 'Atualizar número';
    const cI = $('#contactInstagram'); if(cI) cI.textContent = cfg.instagram || '@studio.__rb';
    const cA = $('#contactAddress'); if(cA) cA.textContent = cfg.address || 'Atualizar endereço';
    const cH = $('#contactHours'); if(cH) cH.textContent = cfg.openingHours || 'Seg a Sáb';
    const insta = $('#instagramLink'); if(insta) insta.href = cfg.instagram && cfg.instagram.startsWith('http') ? cfg.instagram : '#';
  }catch(e){ console.error(e); }
}

const menu=$('#mobileMenu');
const menuBtn=$('#menuBtn');
const closeMenu=$('#closeMenu');
if(menuBtn) menuBtn.onclick=()=>menu.classList.add('open');
if(closeMenu) closeMenu.onclick=()=>menu.classList.remove('open');
$$('#mobileMenu a').forEach(a=>a.addEventListener('click',()=>menu.classList.remove('open')));

const io = new IntersectionObserver(entries=>entries.forEach(e=>e.isIntersecting&&e.target.classList.add('in')),{threshold:.12});
$$('.reveal').forEach(el=>io.observe(el));

const dateInput=$('#bookingDate'), timeGrid=$('#timeGrid');
let timeInput=$('#bookingTime');
if(!timeInput && $('#bookingForm')){
  timeInput=document.createElement('input'); timeInput.type='hidden'; timeInput.id='bookingTime'; timeInput.name='time';
  $('#bookingForm').appendChild(timeInput);
}

if(dateInput){
  const today=new Date(); today.setMinutes(today.getMinutes()-today.getTimezoneOffset());
  dateInput.min=today.toISOString().split('T')[0];
}

async function loadTimes(){
  if(!dateInput || !timeGrid || !timeInput) return;
  timeInput.value=''; timeGrid.innerHTML='<p class="muted">Carregando horários...</p>';
  if(!dateInput.value) return;
  try{
    const r=await fetch('/api/availability?date='+encodeURIComponent(dateInput.value));
    const data=await r.json();
    timeGrid.innerHTML='';
    if(!data.slots?.length){timeGrid.innerHTML='<p class="muted">Não há horários disponíveis para esta data.</p>';return;}
    data.slots.forEach(slot=>{
      const b=document.createElement('button');
      b.type='button'; b.className='time-slot'; b.textContent=slot.time; b.disabled=!slot.available;
      if(!slot.available) b.title='Horário indisponível';
      b.onclick=()=>{$$('.time-slot').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');timeInput.value=slot.time};
      timeGrid.appendChild(b);
    });
  }catch{
    timeGrid.innerHTML='<p class="muted">Não foi possível carregar os horários.</p>'
  }
}
if(dateInput) dateInput.addEventListener('change',loadTimes);

const form = $('#bookingForm');
if(form){
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!timeInput.value){alert('Escolha um horário disponível.');return;}
    const fd=new FormData(e.currentTarget);
    if(dateInput && dateInput.value) fd.set('date', dateInput.value);
    const payload=Object.fromEntries(fd.entries());
    payload.time = timeInput.value;
    try{
      const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const data=await r.json();
      if(!r.ok) throw new Error(data.error||'Erro');
      form.classList.add('hidden');
      $('#successState')?.classList.remove('hidden');
      $('#errorState')?.classList.add('hidden');
    }catch(err){
      form.classList.add('hidden');
      $('#errorState')?.classList.remove('hidden');
      $('#successState')?.classList.add('hidden');
    }
  });
}

$('#newBooking')?.addEventListener('click',()=>location.reload());
const year = $('#year'); if(year) year.textContent=new Date().getFullYear();

loadConfig();



/* ===== álbum interativo ===== */
(function(){
  const album = document.querySelector('[data-album]');
  if(!album) return;

  const mainImage = document.getElementById('albumMainImage');
  const mainTitle = document.getElementById('albumMainTitle');
  const mainText = document.getElementById('albumMainText');
  const mainTag = document.getElementById('albumMainTag');
  const current = document.getElementById('albumCurrent');
  const thumbs = [...album.querySelectorAll('.album-thumb')];
  const prev = album.querySelector('.album-nav.prev');
  const next = album.querySelector('.album-nav.next');
  let index = thumbs.findIndex(t => t.classList.contains('active'));
  if(index < 0) index = 0;

  function apply(i){
    const item = thumbs[i];
    if(!item) return;
    thumbs.forEach(t => t.classList.remove('active'));
    item.classList.add('active');

    const image = item.dataset.image;
    const title = item.dataset.title;
    const text = item.dataset.text;
    const tag = item.dataset.tag;

    mainImage.style.opacity = '0.55';
    setTimeout(() => {
      mainImage.src = image;
      mainImage.alt = title;
      mainTitle.textContent = title;
      mainText.textContent = text;
      mainTag.textContent = tag;
      current.textContent = String(i + 1).padStart(2, '0');
      mainImage.style.opacity = '1';
    }, 120);

    index = i;
  }

  thumbs.forEach((thumb, i) => {
    thumb.addEventListener('click', () => apply(i));
  });

  prev?.addEventListener('click', () => apply((index - 1 + thumbs.length) % thumbs.length));
  next?.addEventListener('click', () => apply((index + 1) % thumbs.length));

  apply(index);
})();
