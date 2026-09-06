
require('dotenv').config();
const express=require('express'), session=require('express-session'), helmet=require('helmet'), compression=require('compression'), rateLimit=require('express-rate-limit'), nodemailer=require('nodemailer');
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const app=express(), PORT=process.env.PORT||3000, DATA=path.join(__dirname,'data');
const cfgPath=path.join(DATA,'config.json'), bookingsPath=path.join(DATA,'bookings.json');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')); const write=(p,d)=>fs.writeFileSync(p,JSON.stringify(d,null,2),'utf8');

app.use(helmet({contentSecurityPolicy:false}));
app.use(compression());
app.use(express.json({limit:'100kb'}));
app.use((req,res,next)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');res.set('Expires','0');next();});
app.use(session({secret:process.env.SESSION_SECRET||'troque-esta-chave-em-producao',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:false,maxAge:1000*60*60*8}}));
app.use('/api/bookings',rateLimit({windowMs:15*60*1000,limit:25,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:'1h'}));

function cleanPhone(v){return String(v||'').replace(/\D/g,'')}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)}
function validTime(v){return /^\d{2}:\d{2}$/.test(v)}
function auth(req,res,next){if(req.session.admin)return next();res.status(401).json({error:'Não autorizado'})}
function slotTaken(bookings,date,time){return bookings.some(b=>b.date===date&&b.time===time&&!['Cancelado'].includes(b.status))}
function getAvailability(date){
  const cfg=read(cfgPath), bookings=read(bookingsPath);
  const d=new Date(date+'T12:00:00');
  if(Number.isNaN(d.getTime())) return [];
  const day=String(d.getDay()), base=cfg.weeklyHours[day]||[];
  if((cfg.blockedDates||[]).includes(date)) return [];
  return base.map(time=>({time,available:!slotTaken(bookings,date,time)&&!(cfg.blockedSlots||[]).some(x=>x.date===date&&x.time===time)}))
}
app.get('/api/config',(req,res)=>{const c=read(cfgPath);res.json({businessName:c.businessName,whatsapp:process.env.OWNER_WHATSAPP||c.whatsapp,email:process.env.OWNER_EMAIL||c.email,instagram:c.instagram,tiktok:c.tiktok,address:c.address,openingHours:c.openingHours})});
app.get('/api/availability',(req,res)=>{const date=String(req.query.date||'');if(!validDate(date))return res.status(400).json({error:'Data inválida'});res.json({date,slots:getAvailability(date)})});

async function notifyOwner(b){
  if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return;
  const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE)==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  const owner=process.env.OWNER_EMAIL||read(cfgPath).email;
  const wa=`https://wa.me/${cleanPhone(b.phone)}`;
  await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:owner,subject:'NOVO AGENDAMENTO — LSH STUDIO RB',html:`<div style="font-family:Arial;background:#0b0b0b;color:#fff;padding:28px;border-radius:16px"><h2 style="color:#ff5b9e">NOVO AGENDAMENTO — LSH STUDIO RB</h2><p><b>Cliente:</b> ${escapeHtml(b.name)}</p><p><b>Telefone/WhatsApp:</b> ${escapeHtml(b.phone)}</p><p><b>Data:</b> ${escapeHtml(b.date)}</p><p><b>Horário:</b> ${escapeHtml(b.time)}</p><a href="${wa}" style="display:inline-block;background:#ff5b9e;color:#111;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:999px">FALAR COM A CLIENTE</a></div>`});
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}

app.post('/api/bookings',async(req,res)=>{
  const name=String(req.body.name||'').trim(),phone=String(req.body.phone||'').trim(),date=String(req.body.date||''),time=String(req.body.time||'');
  if(name.length<2||cleanPhone(phone).length<10||!validDate(date)||!validTime(time))return res.status(400).json({error:'Dados inválidos'});
  const slots=getAvailability(date), slot=slots.find(s=>s.time===time);
  if(!slot||!slot.available)return res.status(409).json({error:'Horário indisponível'});
  const bookings=read(bookingsPath);
  const b={id:crypto.randomUUID(),name:name.slice(0,80),phone:phone.slice(0,20),date,time,status:'Pendente',source:'site',createdAt:new Date().toISOString()};
  bookings.push(b);write(bookingsPath,bookings);
  notifyOwner(b).catch(console.error);
  res.status(201).json({ok:true,id:b.id});
});

app.post('/api/admin/login',(req,res)=>{
  const user=String(req.body.username||''),pass=String(req.body.password||'');
  const eu=process.env.ADMIN_USER||'admin', ep=process.env.ADMIN_PASSWORD||'troque-esta-senha';
  if(user===eu&&pass===ep){req.session.admin=true;return res.json({ok:true})}
  res.status(401).json({error:'Credenciais inválidas'});
});
app.post('/api/admin/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',auth,(req,res)=>res.json({ok:true}));
app.get('/api/admin/bookings',auth,(req,res)=>res.json({bookings:read(bookingsPath)}));
app.post('/api/admin/bookings',auth,(req,res)=>{
  const {name,phone,date,time}=req.body;
  if(!name||!phone||!validDate(String(date))||!validTime(String(time)))return res.status(400).json({error:'Dados inválidos'});
  const arr=read(bookingsPath);if(slotTaken(arr,date,time))return res.status(409).json({error:'Horário ocupado'});
  const b={id:crypto.randomUUID(),name:String(name).slice(0,80),phone:String(phone).slice(0,20),date,time,status:'Confirmado',source:'manual',createdAt:new Date().toISOString()};arr.push(b);write(bookingsPath,arr);res.status(201).json({booking:b});
});
app.patch('/api/admin/bookings/:id',auth,(req,res)=>{
  const allowed=['Pendente','Confirmado','Concluído','Cancelado'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Status inválido'});
  const arr=read(bookingsPath), b=arr.find(x=>x.id===req.params.id);if(!b)return res.status(404).json({error:'Não encontrado'});b.status=req.body.status;write(bookingsPath,arr);res.json({booking:b});
});
app.get('/api/admin/config',auth,(req,res)=>res.json({config:read(cfgPath)}));
app.post('/api/admin/blocks',auth,(req,res)=>{const {date,time}=req.body;if(!validDate(String(date))||!validTime(String(time)))return res.status(400).json({error:'Dados inválidos'});const c=read(cfgPath);c.blockedSlots=c.blockedSlots||[];if(!c.blockedSlots.some(x=>x.date===date&&x.time===time))c.blockedSlots.push({date,time});write(cfgPath,c);res.json({ok:true})});
app.delete('/api/admin/blocks/:i',auth,(req,res)=>{const c=read(cfgPath),i=Number(req.params.i);if(!Number.isInteger(i)||i<0||i>=c.blockedSlots.length)return res.status(404).json({error:'Bloqueio não encontrado'});c.blockedSlots.splice(i,1);write(cfgPath,c);res.json({ok:true})});

app.listen(PORT,()=>console.log(`LSH Studio RB disponível em http://localhost:${PORT}`));
