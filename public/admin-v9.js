let bookings = [], adminConfig = null, currentFilter = 'all';
let calendarCursor = new Date();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const dayNames = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

async function api(url, opts = {}){
  const r = await fetch(url, { ...opts, headers:{'Content-Type':'application/json', ...(opts.headers||{})} });
  let d={}; try{ d=await r.json(); }catch{}
  if(!r.ok) throw new Error(d.error || 'Erro');
  return d;
}
function esc(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function fmtDate(d){ const [y,m,day]=String(d||'').split('-'); return y&&m&&day?`${day}/${m}/${y}`:d; }
function money(v){ return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function monthLabel(d){ return d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).replace(/^./,t=>t.toUpperCase()); }
function dateToISO(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function toast(msg, type='ok'){
  const el=$('#adminToast'); if(!el) return;
  el.textContent=msg; el.className=`admin-toast show ${type}`;
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>el.className='admin-toast',3500);
}

async function check(){ try{ await api('/api/admin/me'); await showDash(); }catch{} }
$('#loginForm').onsubmit=async e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target));
  try{ await api('/api/admin/login',{method:'POST',body:JSON.stringify(d)}); await showDash(); }
  catch{ $('#loginMsg').textContent='Usuário ou senha incorretos.'; }
};
async function showDash(){
  $('#loginView').classList.add('hidden'); $('#dashboard').classList.remove('hidden'); $('#logoutBtn').classList.remove('hidden'); await refresh();
}
$('#logoutBtn').onclick=async()=>{ await api('/api/admin/logout',{method:'POST'}); location.reload(); };

async function refresh(){
  const [b,c,n]=await Promise.all([api('/api/admin/bookings'),api('/api/admin/config'),api('/api/admin/notifications/status')]);
  bookings=b.bookings||[]; adminConfig=c.config||{};
  renderStats(); renderBlocks(); renderCalendar(); renderList(); renderSchedule(); renderServices(); renderNotificationStatus(n); renderGallery();
}
function renderStats(){
  const counts={
    Pendente:bookings.filter(b=>b.status==='Pendente').length,
    Confirmado:bookings.filter(b=>b.status==='Confirmado').length,
    Concluído:bookings.filter(b=>b.status==='Concluído').length,
    Total:bookings.length
  };
  $('#stats').innerHTML=[['Pendentes',counts.Pendente],['Confirmados',counts.Confirmado],['Concluídos',counts.Concluído],['Total',counts.Total]].map(([l,n])=>`<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
}
function renderList(){
  const date=$('#filterDate').value; $('#selectedDateLabel').textContent=date?fmtDate(date):'Todos os dias';
  const list=bookings.filter(b=>(currentFilter==='all'||b.status===currentFilter)&&(!date||b.date===date)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  $('#bookingList').innerHTML=list.length?list.map(b=>{
    const services=(b.services||[]).map(s=>s.name).join(' + ')||'Sem procedimento informado';
    const confirmMsg=`Olá, ${b.name}! 💗 Seu agendamento no Lash Studio RB foi confirmado para ${fmtDate(b.date)} às ${b.time}. Procedimento(s): ${services}. Total: ${money(b.total)}.`;
    return `<div class="booking-card booking-card-v8">
      <div class="booking-main"><b>${esc(b.name)}</b><small>${esc(b.phone)}${b.email?` • ${esc(b.email)}`:''}</small><p>${esc(services)}</p></div>
      <div class="booking-meta"><div><b>Data:</b> ${fmtDate(b.date)}</div><div><b>Horário:</b> ${esc(b.time)}</div><div><b>Total:</b> ${money(b.total)}</div></div>
      <div class="booking-status"><span class="status">${esc(b.status)}</span></div>
      <div class="booking-actions">
        <button class="mini-btn pink" onclick="setStatus('${b.id}','Confirmado')">Confirmar</button>
        <button class="mini-btn" onclick="setStatus('${b.id}','Concluído')">Concluir</button>
        <button class="mini-btn" onclick="setStatus('${b.id}','Cancelado')">Cancelar</button>
        <a class="mini-btn" target="_blank" href="https://wa.me/${String(b.phone).replace(/\D/g,'')}?text=${encodeURIComponent(confirmMsg)}">WhatsApp</a>
        ${b.status==='Confirmado'?`<button class="mini-btn" onclick="resendConfirmation('${b.id}')">Reenviar confirmação</button>`:''}
      </div>
    </div>`;
  }).join(''):'<div class="empty-state">Nenhum agendamento encontrado para esse filtro.</div>';
}
window.setStatus=async(id,status)=>{
  try{
    const d=await api('/api/admin/bookings/'+id,{method:'PATCH',body:JSON.stringify({status})});
    if(status==='Confirmado'&&d.notifications){
      const parts=[]; if(d.notifications.email) parts.push('e-mail enviado'); if(d.notifications.whatsapp) parts.push('WhatsApp automático enviado');
      toast(parts.length?`Confirmado: ${parts.join(' e ')}.`:'Confirmado. Notificação automática não está configurada; use o botão WhatsApp.');
    } else toast(`Status alterado para ${status}.`);
    await refresh();
  }catch(e){ toast(e.message,'error'); }
};

function renderCalendar(){
  const grid=$('#calendarGrid'), label=$('#calendarMonthLabel'); if(!grid||!label)return;
  const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth(); label.textContent=monthLabel(calendarCursor);
  const start=new Date(y,m,1).getDay(), total=new Date(y,m+1,0).getDate(), selected=$('#filterDate').value, today=todayISO();
  const counts={}; bookings.filter(b=>b.status!=='Cancelado').forEach(b=>counts[b.date]=(counts[b.date]||0)+1);
  let html=''; for(let i=0;i<start;i++)html+='<span class="calendar-empty"></span>';
  for(let day=1;day<=total;day++){
    const iso=dateToISO(new Date(y,m,day)), count=counts[iso]||0;
    html+=`<button class="calendar-day ${selected===iso?'active':''} ${today===iso?'today':''}" type="button" data-date="${iso}"><span class="num">${day}</span>${count?`<span class="dot">${count}</span>`:''}</button>`;
  }
  grid.innerHTML=html;
  $$('#calendarGrid .calendar-day').forEach(btn=>btn.onclick=()=>{$('#filterDate').value=btn.dataset.date;renderCalendar();renderList();});
}
$$('.segmented button').forEach(btn=>btn.onclick=()=>{$$('.segmented button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');currentFilter=btn.dataset.filter;renderList();});
$('#filterDate').onchange=()=>{renderCalendar();renderList();};
$('#prevMonth').onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar();};
$('#nextMonth').onclick=()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar();};
$('#todayBtn').onclick=()=>{const n=new Date();calendarCursor=new Date(n.getFullYear(),n.getMonth(),1);$('#filterDate').value=todayISO();renderCalendar();renderList();};
$('#clearDateBtn').onclick=()=>{$('#filterDate').value='';renderCalendar();renderList();};

$('#blockBtn').onclick=async()=>{
  const date=$('#blockDate').value,time=$('#blockTime').value; if(!date||!time)return;
  try{ await api('/api/admin/blocks',{method:'POST',body:JSON.stringify({date,time})});$('#blockTime').value='';await refresh();toast('Horário bloqueado.'); }catch(e){toast(e.message,'error');}
};
function renderBlocks(){
  $('#blocksList').innerHTML=(adminConfig?.blockedSlots||[]).map((x,i)=>`<div class="block-item"><span>${fmtDate(x.date)} • ${x.time}</span><button class="mini-btn" onclick="removeBlock(${i})">Liberar</button></div>`).join('')||'<div class="empty-state">Nenhum horário bloqueado.</div>';
}
window.removeBlock=async i=>{try{await api('/api/admin/blocks/'+i,{method:'DELETE'});await refresh();toast('Horário liberado.');}catch(e){toast(e.message,'error');}};

function renderSchedule(){
  const weekly=adminConfig?.weeklyHours||{};
  $('#scheduleEditor').innerHTML=dayNames.map((name,day)=>`<div class="schedule-day">
    <div class="schedule-day-head"><div><b>${name}</b><small>${(weekly[String(day)]||[]).length?'Atendimento liberado':'Fechado / sem horários'}</small></div><div class="schedule-add"><input type="time" id="dayTime${day}"><button type="button" class="mini-btn pink" onclick="addDayTime(${day})">＋ Horário</button></div></div>
    <div class="schedule-times">${(weekly[String(day)]||[]).map(t=>`<button type="button" class="time-chip" onclick="removeDayTime(${day},'${t}')">${t}<span>×</span></button>`).join('')||'<span class="no-time">Nenhum horário liberado.</span>'}</div>
  </div>`).join('');
}
window.addDayTime=(day)=>{
  const input=$(`#dayTime${day}`); const t=input.value;if(!t)return;
  adminConfig.weeklyHours=adminConfig.weeklyHours||{}; const arr=adminConfig.weeklyHours[String(day)]||[];
  if(!arr.includes(t))arr.push(t); adminConfig.weeklyHours[String(day)]=arr.sort();input.value='';renderSchedule();
};
window.removeDayTime=(day,t)=>{adminConfig.weeklyHours[String(day)]=(adminConfig.weeklyHours[String(day)]||[]).filter(x=>x!==t);renderSchedule();};
$('#saveScheduleBtn').onclick=async()=>{try{await api('/api/admin/schedule',{method:'PUT',body:JSON.stringify({weeklyHours:adminConfig.weeklyHours})});toast('Dias e horários salvos.');await refresh();}catch(e){toast(e.message,'error');}};

function renderServices(){
  const services=adminConfig?.services||[];
  $('#servicesEditor').innerHTML=services.map((s,i)=>`<div class="service-edit-row" data-i="${i}">
    <input class="service-name" value="${esc(s.name)}" placeholder="Nome do procedimento">
    <label><span>Valor (R$)</span><input class="service-price" type="number" min="0" step="0.01" value="${s.price===null?'':Number(s.price)}" placeholder="0,00"></label>
    <label><span>Duração</span><input class="service-duration" type="number" min="15" step="15" value="${Number(s.duration||60)}"></label>
    <label class="service-toggle"><input class="service-active" type="checkbox" ${s.active!==false?'checked':''}><span>Ativo</span></label>
    <button type="button" class="mini-btn danger" onclick="removeService(${i})">Excluir</button>
  </div>`).join('')||'<div class="empty-state">Nenhum procedimento cadastrado.</div>';
}
function collectServices(){
  return $$('.service-edit-row').map((row,i)=>({
    id:(adminConfig.services[i]?.id)||`servico-${Date.now()}-${i}`,
    name:row.querySelector('.service-name').value.trim(),
    price:row.querySelector('.service-price').value===''?null:Number(row.querySelector('.service-price').value),
    duration:Number(row.querySelector('.service-duration').value||60),
    active:row.querySelector('.service-active').checked
  }));
}
$('#addServiceBtn').onclick=()=>{adminConfig.services=collectServices();adminConfig.services.push({id:`servico-${Date.now()}`,name:'Novo procedimento',price:null,duration:60,active:true});renderServices();};
window.removeService=i=>{adminConfig.services=collectServices();adminConfig.services.splice(i,1);renderServices();};
$('#saveServicesBtn').onclick=async()=>{try{const services=collectServices();await api('/api/admin/services',{method:'PUT',body:JSON.stringify({services})});toast('Procedimentos e valores salvos.');await refresh();}catch(e){toast(e.message,'error');}};

function renderNotificationStatus(n){
  $('#notificationStatus').innerHTML=`
    <div class="notify-status ${n.smtpConfigured?'ok':'warn'}"><b>E-mail automático</b><span>${n.smtpConfigured?'Configurado':'Falta configurar SMTP no Render'}</span></div>
    <div class="notify-status ${n.whatsappCloudConfigured?'ok':'warn'}"><b>WhatsApp automático</b><span>${n.whatsappCloudConfigured?'Cloud API configurada':'Opcional — use botão WhatsApp ou configure Meta API'}</span></div>
    <div class="notify-status ${n.database==='postgres'?'ok':'warn'}"><b>Armazenamento</b><span>${n.database==='postgres'?'PostgreSQL persistente':'JSON local — configure DATABASE_URL no Render'}</span></div>`;
}
$('#testEmailBtn').onclick=async()=>{try{const d=await api('/api/admin/notifications/test-email',{method:'POST'});toast('E-mail de teste enviado para '+d.to);}catch(e){toast(e.message,'error');}};

const dlg=$('#manualDialog');
$('#manualBtn').onclick=()=>dlg.showModal();
$('#saveManual').onclick=async e=>{e.preventDefault();const form=$('#manualForm');if(!form.reportValidity())return;const d=Object.fromEntries(new FormData(form));try{await api('/api/admin/bookings',{method:'POST',body:JSON.stringify(d)});dlg.close();form.reset();await refresh();toast('Agendamento manual criado.');}catch(err){toast(err.message,'error');}};

check();


function renderGallery(){
  const box=$('#galleryEditor'), catBox=$('#galleryCategoriesEditor'), select=$('#galleryCategory'); if(!adminConfig) return;
  const cats=Array.isArray(adminConfig.galleryCategories)?adminConfig.galleryCategories:[];
  const items=Array.isArray(adminConfig.gallery)?adminConfig.gallery:[];
  const catName=id=>cats.find(c=>c.id===id)?.name||'Sem categoria';
  if(select){
    const value=select.value;
    select.innerHTML='<option value="">Escolha a categoria</option>'+cats.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    if(cats.some(c=>c.id===value))select.value=value;
  }
  if(catBox){
    catBox.innerHTML=cats.map(c=>`<div class="gallery-category-row">
      <input value="${esc(c.name)}" maxlength="50" aria-label="Nome da categoria ${esc(c.name)}">
      <button type="button" class="mini-btn" onclick="renameGalleryCategory('${esc(c.id)}',this)">Salvar nome</button>
      <button type="button" class="mini-btn danger" onclick="deleteGalleryCategory('${esc(c.id)}')">Excluir aba</button>
    </div>`).join('')||'<div class="booking-alert">Nenhuma categoria criada.</div>';
  }
  if(box){
    box.innerHTML=items.length?items.map(x=>`<article class="gallery-admin-item">
      <img src="${esc(x.src)}" alt="${esc(x.title||'Foto do portfólio')}">
      <div><b>${esc(x.title||'Resultado')}</b><small>${esc(x.caption||'')}</small><span class="gallery-admin-category">${esc(catName(x.categoryId))}</span></div>
      <select class="gallery-move-select" data-id="${esc(x.id)}">${cats.map(c=>`<option value="${esc(c.id)}" ${c.id===x.categoryId?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="gallery-admin-actions"><button type="button" class="mini-btn" onclick="moveGalleryPhoto('${esc(x.id)}',this)">Mover</button><button type="button" class="mini-btn danger" onclick="deleteGalleryPhoto('${esc(x.id)}')">Excluir</button></div>
    </article>`).join(''):'<div class="booking-alert">Nenhuma foto cadastrada.</div>';
  }
}

$('#addGalleryCategoryForm')?.addEventListener('submit',async e=>{
  e.preventDefault(); const input=$('#newGalleryCategoryName'); const name=input.value.trim(); if(name.length<2){toast('Digite o nome da nova aba.','error');return;}
  try{await api('/api/admin/gallery-categories',{method:'POST',body:JSON.stringify({name})});input.value='';toast('Nova aba criada.');await refresh();}catch(err){toast(err.message,'error');}
});
window.renameGalleryCategory=async(id,btn)=>{
  const input=btn.closest('.gallery-category-row').querySelector('input');
  try{await api('/api/admin/gallery-categories/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({name:input.value.trim()})});toast('Nome da aba atualizado.');await refresh();}catch(e){toast(e.message,'error');}
};
window.deleteGalleryCategory=async id=>{
  if(!confirm('Excluir esta aba? As fotos dela serão movidas para outra categoria.'))return;
  try{await api('/api/admin/gallery-categories/'+encodeURIComponent(id),{method:'DELETE'});toast('Aba excluída.');await refresh();}catch(e){toast(e.message,'error');}
};
window.moveGalleryPhoto=async(id,btn)=>{
  const select=btn.closest('.gallery-admin-item').querySelector('.gallery-move-select');
  try{await api('/api/admin/gallery/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({categoryId:select.value})});toast('Foto movida para outra aba.');await refresh();}catch(e){toast(e.message,'error');}
};

async function compressPhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Envie JPG, PNG ou WEBP.');
  const bitmap=await createImageBitmap(file);
  const max=1280;
  const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const w=Math.max(1,Math.round(bitmap.width*scale)), h=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext('2d',{alpha:false}); ctx.drawImage(bitmap,0,0,w,h); bitmap.close?.();
  let quality=.82, data='';
  do{ data=canvas.toDataURL('image/webp',quality); quality-=.08; }while(data.length>650000&&quality>=.5);
  if(data.length>750000) throw new Error('Essa foto ficou muito pesada. Tente outra imagem.');
  return data;
}
$('#galleryUploadForm')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const file=$('#galleryPhoto')?.files?.[0];
  if(!file){toast('Escolha uma foto.','error');return;}
  const btn=e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled=true; btn.textContent='OTIMIZANDO...';
  try{
    const image=await compressPhoto(file); btn.textContent='ENVIANDO...';
    const d=await api('/api/admin/gallery',{method:'POST',body:JSON.stringify({image,categoryId:$('#galleryCategory')?.value||'',title:$('#galleryTitle')?.value||'',caption:$('#galleryCaption')?.value||''})});
    e.currentTarget.reset(); toast('Foto otimizada e adicionada ao site.'); await refresh();
  }catch(err){toast(err.message,'error');}
  finally{btn.disabled=false;btn.textContent='ADICIONAR FOTO';}
});
window.deleteGalleryPhoto=async id=>{
  if(!confirm('Excluir esta foto do site?')) return;
  try{await api('/api/admin/gallery/'+encodeURIComponent(id),{method:'DELETE'});toast('Foto excluída.');await refresh();}catch(e){toast(e.message,'error');}
};
window.resendConfirmation=async id=>{
  try{
    const d=await api('/api/admin/bookings/'+id+'/resend-confirmation',{method:'POST'});
    const n=d.notifications||{};
    const ok=[]; if(n.email)ok.push('e-mail'); if(n.whatsapp)ok.push('WhatsApp');
    toast(ok.length?'Confirmação reenviada por '+ok.join(' e ')+'.':'Nenhum canal automático configurado. Use o botão WhatsApp.');
  }catch(e){toast(e.message,'error');}
};
