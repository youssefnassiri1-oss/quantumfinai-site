const pill=n=>`<div class="pill"><i>${n.slice(0,2).toUpperCase()}</i>${n}</div>`;
const t=document.getElementById('toast');let tm;
function toast(m){t.textContent=m;t.classList.add('on');clearTimeout(tm);tm=setTimeout(()=>t.classList.remove('on'),2600)}
document.addEventListener('click',e=>{const b=e.target.closest('[data-toast]');if(b)toast(b.dataset.toast)});
// Supabase Auth (REST, no library). Fill these two after the project is wired.
const SB_URL="https://rofcjlvxzctevqjzgvyt.supabase.co",SB_KEY="sb_publishable_F4LnZ_xwqjOHEU_k9GdaEQ_uL2lctJq";
let mode='signup';const f=document.getElementById('signup'),m=document.getElementById('formmsg');
const say=(t,ok)=>{m.style.color=ok?'#86efac':'#fca5a5';m.textContent=t};
document.querySelectorAll('.tabs .tab').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;
document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.toggle('on',x===b));
document.getElementById('lname').style.display=mode==='signup'?'':'none';
document.getElementById('fsubmit').textContent=mode==='signup'?'Create account':'Sign in';
document.getElementById('ftitle').textContent=mode==='signup'?'Create an account':'Sign in';
f.pw.autocomplete=mode==='signup'?'new-password':'current-password'}));
function showUser(email){if(!email)return;const w=document.getElementById('who');w.hidden=false;w.textContent='✓ Signed in as '+email;document.getElementById('balnote').textContent='Signed in as '+email+'. Your balance is 0 points. No offers are live yet.';}
async function sb(path,body){const r=await fetch(SB_URL+path,{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});return[r,await r.json().catch(()=>({}))]}
f.addEventListener('submit',async e=>{e.preventDefault();
if(!/^\S+@\S+\.\S+$/.test(f.email.value)||f.pw.value.length<8){say('Check your email and password (8 characters minimum)');return}
if(mode==='signup'&&!f.name.value.trim()){say('Name is required');return}
if(!SB_KEY){say('Accounts are opening soon. Please try again later.',true);return}
try{if(mode==='signup'){const[r,d]=await sb('/auth/v1/signup',{email:f.email.value,password:f.pw.value,data:{name:f.name.value.trim()}});
if(!r.ok)throw d;say('✓ Account created. Check your email to confirm, then sign in.',true)}
else{const[r,d]=await sb('/auth/v1/token?grant_type=password',{email:f.email.value,password:f.pw.value});
if(!r.ok)throw d;say('✓ Welcome back',true);setSess(d);enter()}}
catch(x){say(x&&x.msg?(x.msg.includes('Invalid login')?'Wrong email or password':x.msg):'Could not connect, try again later')}});

document.documentElement.classList.add('js');
const rv=[...document.querySelectorAll('section:not(.hero) h2,.card,.pill,.cardbox,.formbox,.sh,.faq details,.stats div')];
rv.forEach((el,i)=>{el.classList.add('rv');el.style.transitionDelay=(i%4)*60+'ms'});
let tick=false;function reveal(){tick=false;const h=innerHeight;rv.forEach(el=>{if(!el.classList.contains('in')&&el.getBoundingClientRect().top<h*0.92)el.classList.add('in')})}
function req(){if(!tick){tick=true;requestAnimationFrame(reveal)}}
addEventListener('scroll',req,{passive:true});addEventListener('resize',req);reveal();
setTimeout(()=>rv.forEach(el=>el.classList.add('in')),5000);

// ---- account area (records only, all writes go through checked database functions) ----
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let S=JSON.parse(localStorage.getItem('qf_s')||'null'),ADMIN=false;
const setSess=d=>{S={a:d.access_token,r:d.refresh_token,e:Date.now()+(d.expires_in||3600)*1000-60000,u:(d.user&&d.user.email)||''};localStorage.setItem('qf_s',JSON.stringify(S))};
async function tok(){if(!S)return null;if(Date.now()>S.e){const[r,d]=await sb('/auth/v1/token?grant_type=refresh_token',{refresh_token:S.r});if(!r.ok){S=null;localStorage.removeItem('qf_s');return null}const u=S.u;setSess(d);S.u=u;localStorage.setItem('qf_s',JSON.stringify(S))}return S.a}
async function api(path,method,body){const k=await tok();const h={apikey:SB_KEY,'Content-Type':'application/json'};if(k)h.Authorization='Bearer '+k;
const r=await fetch(SB_URL+'/rest/v1/'+path,{method:method||'GET',headers:h,body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>null);
if(!r.ok)throw new Error((d&&d.message)||'Request failed');return d}
const rpc=(n,b)=>api('rpc/'+n,'POST',b||{});
const badge=s=>`<span class="st st-${esc(s)}">${esc(s.replace('_',' '))}</span>`;
const when=t=>new Date(t).toLocaleString();
const row=(a,b,c)=>`<div class="lrow"><div>${a}</div><div class="lm">${b||''}</div><div class="la">${c||''}</div></div>`;
const empty=t=>`<p class="note">${t}</p>`;
const CH=['All','Surveys','Apps','Games','Trials','Tasks'];
document.getElementById('chips').innerHTML=CH.map((n,i)=>`<div class="pill${i?'':' on'}">${n}</div>`).join('');
const SLOTS=Array.from({length:6},()=>`<article class="card slot"><div class="thumb">+</div><span class="tag">Coming soon</span><h3>Partner company</h3><p>Offer details coming soon.</p><div class="pts">-- points</div></article>`).join('');
document.getElementById('offergrid').innerHTML=SLOTS;
async function loadPublic(){try{const[o,m,nets]=await Promise.all([api('offers?select=id,title,description,category,points&status=eq.active&order=created_at.desc'),api('withdrawal_methods?select=code,label,min_points&active=eq.true'),api('partners?select=id,name,website,description,network_type&active=eq.true&order=name')]);
window.NETS=nets;document.getElementById('netgrid').innerHTML=nets.map(n=>`<article class="card"><div class="thumb">${esc(n.name.slice(0,2).toUpperCase())}</div><span class="tag">${esc(n.network_type)}</span><h3>${esc(n.name)}</h3><p>${esc(n.description||'')}</p>${n.website?`<a class="btn small ghost" href="${esc(n.website)}" target="_blank" rel="noopener noreferrer">Visit website</a>`:''}</article>`).join('');
document.getElementById('offergrid').innerHTML=o.length?o.map(x=>`<article class="card"><div class="thumb">◇</div><span class="tag">${esc(x.category)}</span><h3>${esc(x.title)}</h3><p>${esc(x.description||'')}</p><div class="pts">${x.points} points</div><a class="btn small" href="#account">Sign in to start</a></article>`).join(''):SLOTS;
document.getElementById('wd').innerHTML=m.map(x=>`<div class="pill"><i>${esc(x.label.slice(0,2).toUpperCase())}</i>${esc(x.label)}<small>from ${x.min_points} points</small></div>`).join('');
document.getElementById('wdm').innerHTML=m.map(x=>`<option value="${esc(x.code)}">${esc(x.label)} (min ${x.min_points})</option>`).join('')}catch(e){}}
async function loadDash(){try{
const[bal,offers,claims,led,wds]=await Promise.all([rpc('my_balance'),api('offers?select=id,title,description,category,points&status=eq.active'),api('offer_claims?select=*,offers(title,points)&order=created_at.desc'),api('points_ledger?select=*&order=created_at.desc&limit=50'),api('withdrawal_requests?select=*&order=created_at.desc')]);
document.getElementById('bal').textContent=bal;document.getElementById('dbal').textContent=bal;
document.getElementById('balnote').textContent='Signed in as '+S.u+'. Your balance is '+bal+' points.';
document.getElementById('dwho').textContent='Signed in as '+S.u;
const taken=new Set(claims.map(c=>c.offer_id));
document.getElementById('doffers').innerHTML=offers.length?offers.map(o=>`<article class="card"><span class="tag">${esc(o.category)}</span><h3>${esc(o.title)}</h3><p>${esc(o.description||'')}</p><div class="pts">${o.points} points</div>${taken.has(o.id)?'<span class="tag">Started</span>':`<button class="btn small" data-claim="${o.id}">Start offer</button>`}</article>`).join(''):empty('No offers are available yet. Partner offers will appear here.');
document.getElementById('dclaims').innerHTML=claims.length?claims.map(c=>row(esc(c.offers?c.offers.title:'Offer'),badge(c.status)+' '+esc(c.admin_note||''),c.status==='pending'?`<button class="btn small" data-submit="${c.id}">Mark completed</button>`:when(c.updated_at))).join(''):empty('You have not started any offers.');
document.getElementById('dledger').innerHTML=led.length?led.map(l=>row((l.delta>0?'+':'')+l.delta+' points',esc(l.reason.replace(/_/g,' ')),when(l.created_at))).join(''):empty('No points yet.');
document.getElementById('dwd').innerHTML=wds.length?wds.map(w=>row(w.points+' points via '+esc(w.method_code.replace(/_/g,' ')),badge(w.status)+' '+esc(w.admin_note||''),w.status==='requested'?`<button class="btn small ghost" data-cancel="${w.id}">Cancel</button>`:when(w.updated_at))).join(''):empty('No withdrawal requests yet.');
if(ADMIN)loadAdmin()}catch(e){toast(e.message)}}
async function loadAdmin(){try{
const[cl,wd,of,fl,ur,pb]=await Promise.all([api('offer_claims?select=*,offers(title)&status=in.(pending,completed,approved)&order=created_at.desc&limit=100'),api('withdrawal_requests?select=*&status=in.(requested,under_review,approved)&order=created_at'),api('offers?select=id,title,points,status,min_seconds,max_claims,partners(name)&order=created_at.desc'),api('fraud_flags?select=*&resolved=eq.false&order=created_at.desc&limit=100'),api('user_risk?select=*&status=in.(review,blocked)&order=updated_at.desc'),api('postback_events?select=*,partners(name)&order=created_at.desc&limit=50')]);
document.getElementById('pbn').innerHTML=(window.NETS||[]).map(n=>`<option value="${esc(n.id)}">${esc(n.name)}</option>`).join('');
const fc={};fl.forEach(x=>{fc[x.user_id]=(fc[x.user_id]||0)+1});
document.getElementById('aclaims').innerHTML=cl.length?cl.map(c=>row(esc(c.offers.title)+'<br><small>'+esc(c.user_id.slice(0,8))+(fc[c.user_id]?' | '+fc[c.user_id]+' open flag(s)':'')+'</small>',badge(c.status)+' '+esc(c.proof_note||''),c.status==='approved'?`<button class="btn small ghost" data-rev="${c.id}">Reverse</button>`:c.status==='completed'?`<button class="btn small" data-rc="${c.id}|approved">Approve</button> <button class="btn small ghost" data-rc="${c.id}|rejected">Reject</button>`:`<button class="btn small ghost" data-rc="${c.id}|rejected">Reject</button>`)).join(''):empty('Nothing to review.');
const nxt={requested:['under_review','Start review'],under_review:['approved','Approve'],approved:['paid','Mark paid (manual record)']};
document.getElementById('awd').innerHTML=wd.length?wd.map(w=>row(w.points+' points, '+esc(w.method_code.replace(/_/g,' '))+'<br><small>'+esc(w.destination)+' | user '+esc(w.user_id.slice(0,8))+'</small>',badge(w.status),`<button class="btn small" data-rw="${w.id}|${nxt[w.status][0]}">${nxt[w.status][1]}</button> <button class="btn small ghost" data-rw="${w.id}|rejected">Reject</button>`)).join(''):empty('No open requests.');
document.getElementById('aflags').innerHTML=fl.length?fl.map(x=>row(esc(x.kind.replace(/_/g,' '))+' '+badge(x.severity)+'<br><small>'+esc(x.detail||'')+(x.user_id?' | user '+esc(x.user_id.slice(0,8)):'')+'</small>',when(x.created_at),(x.user_id?`<button class="btn small ghost" data-us="${x.user_id}|review">Review</button> <button class="btn small ghost" data-us="${x.user_id}|blocked">Block</button> `:'')+`<button class="btn small" data-rf="${x.id}">Resolve</button>`)).join(''):empty('No open flags.');
document.getElementById('ausers').innerHTML=ur.length?ur.map(x=>row('User '+esc(x.user_id.slice(0,8))+'<br><small>'+esc(x.note||'')+'</small>',badge(x.status),`<button class="btn small" data-us="${x.user_id}|normal">Clear</button> `+(x.status==='blocked'?'':`<button class="btn small ghost" data-us="${x.user_id}|blocked">Block</button>`))).join(''):empty('No users under review.');
document.getElementById('apb').innerHTML=pb.length?pb.map(x=>row(esc(x.partners?x.partners.name:'')+' | '+esc(x.external_txn_id)+'<br><small>'+esc(x.event_type)+(x.points!=null?' | '+x.points+' points':'')+'</small>',badge(x.signature_ok?'verified':'rejected'),when(x.created_at))).join(''):empty('No confirmations recorded.');
document.getElementById('aoffers').innerHTML=of.map(o=>row(esc(o.title)+'<br><small>'+esc(o.partners?o.partners.name:'')+'</small>',o.points+' points '+badge(o.status),`<button class="btn small ghost" data-os="${o.id}|${o.status==='active'?'paused':'active'}">${o.status==='active'?'Pause':'Activate'}</button>`)).join('')||empty('No offers yet.')}catch(e){toast(e.message)}}
async function enter(){document.getElementById('dash').hidden=false;document.getElementById('who').hidden=true;
try{ADMIN=await rpc('is_admin')===true}catch(e){ADMIN=false}document.getElementById('tabadmin').hidden=!ADMIN;regDevice();await loadDash();document.getElementById('dash').scrollIntoView({behavior:'smooth'})}
document.getElementById('dtabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='signout'){S=null;localStorage.removeItem('qf_s');document.getElementById('dash').hidden=true;document.getElementById('balnote').textContent='Sign in to see your points and requests.';document.getElementById('bal').textContent='0';scrollTo({top:0,behavior:'smooth'});return}
document.querySelectorAll('#dtabs .tab').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('.dpane').forEach(p=>p.hidden=p.id!==b.dataset.t)});
const REFUSED='This request could not be completed. It has been recorded for review.';
async function act(fn,ok,needVal){try{const r=await fn();if(r==='too_fast'){toast('Submitted too quickly. Please complete the offer first, then try again.');return}if(needVal&&!r){toast(REFUSED);await loadDash();return}toast(ok);await loadDash()}catch(e){toast(e.message)}}
document.getElementById('dash').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
if(d.claim)act(()=>rpc('claim_offer',{p_offer:d.claim}),'Offer started',true);
if(d.submit){const n=prompt('Add a short note for the reviewer (optional)');if(n!==null)act(()=>rpc('submit_claim',{p_claim:d.submit,p_note:n}),'Sent for review')}
if(d.cancel)act(()=>rpc('cancel_withdrawal',{p_id:d.cancel}),'Request cancelled');
if(d.rc){const[i,s]=d.rc.split('|');const n=prompt('Note (optional)')||'';act(()=>rpc('admin_review_claim',{p_claim:i,p_status:s,p_note:n}),'Claim '+s)}
if(d.rw){const[i,s]=d.rw.split('|');const n=prompt('Note (optional)')||'';act(()=>rpc('admin_review_withdrawal',{p_id:i,p_status:s,p_note:n}),'Request '+s.replace('_',' '))}
if(d.rev){const n=prompt('Reason for reversal')||'';act(()=>rpc('admin_reverse_claim',{p_claim:d.rev,p_note:n}),'Claim reversed')}
if(d.us){const[i,s]=d.us.split('|');act(()=>rpc('admin_set_user_status',{p_user:i,p_status:s,p_note:'Set by admin'}),'User status: '+s)}
if(d.rf)act(()=>rpc('admin_resolve_flag',{p_id:d.rf}),'Flag resolved')
if(d.os){const[i,s]=d.os.split('|');act(()=>rpc('admin_set_offer_status',{p_offer:i,p_status:s}),'Offer updated')}});
document.getElementById('wdform').addEventListener('submit',e=>{e.preventDefault();const f=e.target;act(async()=>{const r=await rpc('request_withdrawal',{p_method:f.m.value,p_points:parseInt(f.p.value,10),p_destination:f.d.value});if(r)f.reset();return r},'Request sent',true)});
document.getElementById('offform').addEventListener('submit',e=>{e.preventDefault();const f=e.target;act(async()=>{const id=await rpc('admin_save_offer',{p_partner:f.pa.value,p_title:f.t.value,p_description:f.d.value,p_category:f.c.value,p_points:parseInt(f.p.value,10),p_status:f.s.value});if(id&&(f.ms.value||f.mc.value))await rpc('admin_set_offer_limits',{p_offer:id,p_min_seconds:parseInt(f.ms.value||'0',10),p_max_claims:parseInt(f.mc.value||'0',10)});f.reset();loadPublic()},'Offer saved')});
document.getElementById('pbform').addEventListener('submit',e=>{e.preventDefault();const f=e.target;act(async()=>{const c=f.c.value.trim();await rpc('admin_record_postback',{p_partner:f.n.value,p_txn:f.x.value.trim(),p_type:f.t.value,p_user:null,p_claim:c||null,p_points:f.p.value?parseInt(f.p.value,10):null,p_sig:f.s.checked,p_raw:''});f.reset()},'Confirmation recorded')});
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function regDevice(){try{let id=localStorage.getItem('qf_d');if(!id){id=crypto.randomUUID();localStorage.setItem('qf_d',id)}await rpc('register_device',{p_hash:await sha('qf|'+id)})}catch(e){}}
loadPublic();if(S)enter();
