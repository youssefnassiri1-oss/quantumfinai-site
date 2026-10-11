const P=[
["📘","دليل المحاسبة الذكية","Guide comptable intelligent","المشكلة: المبتدئون يضيعون وقتا في فهم القيود المحاسبية. الحل: دليل خطوة بخطوة مع أمثلة من المخطط المحاسبي المغربي (CGNC).","Définition : la comptabilité générale enregistre chaque opération en débit et crédit pour produire bilan et compte de résultat.","49 MAD"],
["📈","لوحة تحليل مالي","Tableau de bord financier","المشكلة: الأرقام مبعثرة في ملفات كثيرة. الحل: لوحة واحدة تعرض السيولة والمردودية والمديونية بمؤشرات واضحة.","Définition : un tableau de bord suit des ratios clés (liquidité, rentabilité, endettement) pour décider vite.","99 MAD"],
["🧮","قوالب إكسل للتدقيق","Modèles Excel pour l'audit","المشكلة: إعداد أوراق العمل يستهلك ساعات. الحل: قوالب جاهزة لاختبار العينات والمطابقات وتتبع الملاحظات.","Définition : l'audit financier vérifie que les comptes donnent une image fidèle de la situation de l'entreprise.","29 MAD"],
["🔐","أداة تقييم المخاطر","Outil d'évaluation des risques","المشكلة: المخاطر لا تُقاس بشكل موحد. الحل: مصفوفة تقيّم احتمال الخطر وأثره وتصنّفه بالألوان.","Définition : le risque = probabilité x impact. La matrice aide à prioriser les contrôles.","149 MAD"],
["⚛️","محاكي المحفظة الكمّي","Simulateur de portefeuille quantique","المشكلة: اختيار توزيع الأصول معقد عندما تكثر الاحتمالات. الحل: عرض تجريبي لفكرة الحوسبة الكمّية في تحسين المحفظة.","Définition : l'informatique quantique utilise des qubits, capables d'explorer plusieurs combinaisons à la fois.","199 MAD"],
["🗂️","حزمة التقارير الجاهزة","Pack de rapports financiers","المشكلة: كتابة التقارير الدورية متكررة. الحل: نماذج جاهزة لتقرير شهري وفصلي مع شروحات للأرقام.","Définition : un reporting financier résume périodiquement performance, trésorerie et écarts au budget.","59 MAD"]];
const PAY=["Visa","Mastercard","CMI","PayPal","Virement bancaire|تحويل بنكي","Cash Plus","Wafacash","USDT (TRC20)"];
const WD=["Virement bancaire|تحويل بنكي","Cash Plus","Wafacash","PayPal","USDT (TRC20)","Payoneer"];
const pill=n=>{const[a,b]=n.split('|');return `<div class="pill"><i>${a.slice(0,3).toUpperCase()}</i>${b?b+' · '+a:a}</div>`};
document.getElementById('pay').innerHTML=PAY.map(pill).join('');document.getElementById('wd').innerHTML=WD.map(pill).join('');
document.getElementById('products').innerHTML=P.map(p=>`<article class="card"><div class="thumb">${p[0]}</div><span class="tag">تجريبي</span><h3>${p[1]}</h3><small class="def">${p[2]}</small><p>${p[3]}</p><p class="def">${p[4]}</p><div class="price">${p[5]}</div><button class="btn small" data-toast="لا يوجد دفع حقيقي : هذا عرض تجريبي">أضف إلى السلة</button></article>`).join('');
const t=document.getElementById('toast');let tm;
function toast(m){t.textContent=m;t.classList.add('on');clearTimeout(tm);tm=setTimeout(()=>t.classList.remove('on'),2600)}
document.addEventListener('click',e=>{const b=e.target.closest('[data-toast]');if(b)toast(b.dataset.toast)});
document.getElementById('dl').addEventListener('click',()=>{document.getElementById('dlmsg').textContent='✓ بدأ التحميل · Téléchargement lancé';toast('تم بدء التحميل')});
const ENDPOINT="";// Formspree URL, ex: https://formspree.io/f/xxxxxxxx
document.getElementById('signup').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,m=document.getElementById('formmsg');
if(!f.name.value.trim()||!/^\S+@\S+\.\S+$/.test(f.email.value)){m.style.color='#fca5a5';m.textContent='تحقق من الاسم والبريد الإلكتروني';return}
if(ENDPOINT){try{const r=await fetch(ENDPOINT,{method:'POST',headers:{Accept:'application/json'},body:new FormData(f)});if(!r.ok)throw 0}catch(_){m.style.color='#fca5a5';m.textContent='تعذر الإرسال، حاول لاحقا';return}}
m.style.color='#86efac';m.textContent='✓ شكرا '+f.name.value.trim()+'، تم تسجيلك'+(ENDPOINT?'.':' (وضع تجريبي: لم يتم حفظ أي بيانات).');f.reset()});
