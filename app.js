const card=(ico,t,extra)=>`<article class="card"><div class="thumb">${ico}</div><span class="tag">Coming soon</span><h3>${t}</h3><p>Details coming soon.</p>${extra||''}</article>`;
const PN=["FinPulse","PayFlow","WealthAI","CreditIQ","FinSight","NeoLedger"],CN=["Fintech Fundamentals","Financial Analysis Basics","AI for Finance"],SN=["Smart Financial Assistant","Report Analyzer","Credit Risk Engine"];
document.getElementById('products').innerHTML=PN.map(n=>card('◇',n)).join('');
document.getElementById('courses').innerHTML=CN.map(n=>card('▢',n)).join('');
document.getElementById('solutions').innerHTML=SN.map(n=>card('◎',n)).join('');
const PAY=["Visa","Mastercard","Bank transfer","PayPal","USDT (TRC20)"];
const WD=["Bank transfer","PayPal","USDT (TRC20)","Payoneer"];
const pill=n=>`<div class="pill"><i>${n.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase()}</i>${n}</div>`;
document.getElementById('pay').innerHTML=PAY.map(pill).join('');document.getElementById('wd').innerHTML=WD.map(pill).join('');
const t=document.getElementById('toast');let tm;
function toast(m){t.textContent=m;t.classList.add('on');clearTimeout(tm);tm=setTimeout(()=>t.classList.remove('on'),2600)}
document.addEventListener('click',e=>{const b=e.target.closest('[data-toast]');if(b)toast(b.dataset.toast)});
document.getElementById('dl').addEventListener('click',()=>{document.getElementById('dlmsg').textContent='✓ Download started';toast('Download started')});
// Supabase Auth (REST, no library). Fill these two after the project is wired.
const SB_URL="https://rofcjlvxzctevqjzgvyt.supabase.co",SB_KEY="sb_publishable_F4LnZ_xwqjOHEU_k9GdaEQ_uL2lctJq";
let mode='signup';const f=document.getElementById('signup'),m=document.getElementById('formmsg');
const say=(t,ok)=>{m.style.color=ok?'#86efac':'#fca5a5';m.textContent=t};
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;
document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===b));
document.getElementById('lname').style.display=mode==='signup'?'':'none';
document.getElementById('fsubmit').textContent=mode==='signup'?'Create account':'Sign in';
document.getElementById('ftitle').textContent=mode==='signup'?'Create an account':'Sign in';
f.pw.autocomplete=mode==='signup'?'new-password':'current-password'}));
function showUser(email){const w=document.getElementById('who');w.hidden=false;w.textContent='✓ Signed in as '+email;}
async function sb(path,body){const r=await fetch(SB_URL+path,{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});return[r,await r.json().catch(()=>({}))]}
f.addEventListener('submit',async e=>{e.preventDefault();
if(!/^\S+@\S+\.\S+$/.test(f.email.value)||f.pw.value.length<8){say('Check your email and password (8 characters minimum)');return}
if(mode==='signup'&&!f.name.value.trim()){say('Name is required');return}
if(!SB_KEY){say('Accounts are opening soon. Please try again later.',true);return}
try{if(mode==='signup'){const[r,d]=await sb('/auth/v1/signup',{email:f.email.value,password:f.pw.value,data:{name:f.name.value.trim()}});
if(!r.ok)throw d;say('✓ Account created. Check your email to confirm, then sign in.',true)}
else{const[r,d]=await sb('/auth/v1/token?grant_type=password',{email:f.email.value,password:f.pw.value});
if(!r.ok)throw d;say('✓ Welcome back',true);showUser(f.email.value)}}
catch(x){say(x&&x.msg?(x.msg.includes('Invalid login')?'Wrong email or password':x.msg):'Could not connect, try again later')}});

document.documentElement.classList.add('js');
const rv=[...document.querySelectorAll('section:not(.hero) h2,.card,.pill,.cardbox,.formbox,.sh')];
rv.forEach((el,i)=>{el.classList.add('rv');el.style.transitionDelay=(i%4)*60+'ms'});
let tick=false;function reveal(){tick=false;const h=innerHeight;rv.forEach(el=>{if(!el.classList.contains('in')&&el.getBoundingClientRect().top<h*0.92)el.classList.add('in')})}
function req(){if(!tick){tick=true;requestAnimationFrame(reveal)}}
addEventListener('scroll',req,{passive:true});addEventListener('resize',req);reveal();
setTimeout(()=>rv.forEach(el=>el.classList.add('in')),5000);
