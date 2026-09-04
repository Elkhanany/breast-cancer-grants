const midnight = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const TODAY = midnight();   /* for chart geometry only; days() re-reads the clock */
/* ISO 'YYYY-MM-DD' parses as UTC via new Date(); parse as LOCAL so dots and day-counts agree. */
const pd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const CATS = [['government','Government'],['state','State / CPRIT'],['institutional','Institutional / BCM'],
              ['foundation','Foundation'],['trial-funding','Trial funding'],['organization','Organization']];
const FOCI = [['computational','Computational / RWD'],['iit','Investigator trials'],
              ['translational','Translational'],['equity','Health equity']];
const FLABEL = Object.fromEntries(FOCI);

/* Profile lives in this browser only. Nothing personal is ever committed to the repo. */
const PROFILE_KEY = 'bcgr.profile.v1';
const DEFAULT_PROFILE = { track:'unknown', facultyYear:2020, fellowshipYear:2020 };
function loadProfile(){
  try { return Object.assign({}, DEFAULT_PROFILE, JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}')); }
  catch(e){ return Object.assign({}, DEFAULT_PROFILE); }
}
function saveProfile(p){ try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch(e){} }
let PROFILE = loadProfile();

let DATA = [], CHANGELOG = {entries:[]}, GENERATED = '', CANDIDATES = [], SIGNALS = null;
/* Re-read midnight per call so a tab left open overnight does not keep yesterday's counts. */
function days(d){ if(!d) return null; return Math.round((pd(d) - midnight())/864e5); }
function normalize(raw){
  return raw.map((g, idx) => ({
    idx,
    s:g.sponsor, sf:g.sponsor_full, p:g.program, c:g.category, t:g.tier, f:g.fit,
    v:g.verdict, rs:g.flags||[], tg:g.track_gate, loi:g.loi_deadline, fa:g.full_deadline,
    d:g.next_deadline, do:days(g.next_deadline), ds:g.deadline_status,
    amt:g.award_usd, amtx:g.award_text, yr:g.duration_years, ic:g.indirects,
    cy:g.cycle, fit:g.er_her2_fit, fo:g.focus||[], bs:g.breast_specific, cap:g.career_cap,
    lim:g.limited_submission, el:g.eligibility, n:g.notes, cf:g.confidence, u:g.url, ev:g.evidence,
    st:g.status, ro:g.retired_on, rr:g.retired_reason, lv:g.last_verified, fs:g.first_seen
  }));
}

let track=PROFILE.track, sortBy='fit', verd='live', tier='', q='';
let cats=new Set(), foci=new Set(), month=null, urg=null;
const open=new Set();

/* Track re-resolution: the gate direction decides whether a gated award is live for him. */
function resolve(r){
  if(r.v!=='track-gated') return r.v;
  if(track==='unknown') return 'track-gated';
  const needsTenure = (r.tg||'').includes('requires tenure-track');
  const needsNon    = (r.tg||'').includes('requires NON-tenure-track');
  if(needsTenure) return track==='tenure' ? 'eligible' : 'ruled-out';
  if(needsNon)    return track==='nontenure' ? 'eligible' : 'ruled-out';
  return 'track-gated';
}
const band = d => d==null ? 'roll' : d<0 ? 'past' : d<=14 ? 'crit' : d<=45 ? 'soon' : d<=120 ? 'range' : 'later';
const BANDLABEL={crit:'≤14 days',soon:'≤45 days',range:'≤120 days',later:'beyond 120',roll:'rolling / TBD',past:'passed'};
const money = v => !v ? '—' : v>=1e6 ? '$'+(v/1e6).toFixed(v%1e6?1:0)+'M' : '$'+Math.round(v/1e3)+'K';
const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = s => { if(!s) return null; const [y,m,d]=s.split('-');
  return d+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]+' '+y; };

function matchQ(r){
  if(!q) return true;
  const h=[r.s,r.sf,r.p,r.el,r.n,r.ev,r.cap,r.amtx,r.u,r.fo.join(' ')]
    .filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every(t=>h.includes(t));
}
/* skip names one dimension to ignore, so a facet never counts itself out of existence. */
function pool(skip){
  return DATA.filter(r=>{
    const v=resolve(r);
    if(verd==='retired'){ if(r.st!=='retired') return false; }
    else if(r.st==='retired') return false;
    else if(verd==='live'){ if(v==='ruled-out') return false; }
    else if(verd!=='all' && v!==verd) return false;
    if(skip!=='tier') if(tier && r.t!==tier) return false;
    if(skip!=='cat') if(cats.size && !cats.has(r.c)) return false;
    if(skip!=='focus') if(foci.size && !r.fo.some(f=>foci.has(f))) return false;
    if(skip!=='urg') if(urg && band(r.do)!==urg) return false;
    if(skip!=='month') if(month && (r.d||'').slice(0,7)!==month) return false;
    if(!matchQ(r)) return false;
    return true;
  });
}
function sortRows(rows){
  const c={
    fit:(a,b)=>b.f-a.f,
    date:(a,b)=>(a.d?Date.parse(a.d):9e15)-(b.d?Date.parse(b.d):9e15),
    amt:(a,b)=>(b.amt||0)-(a.amt||0),
    sponsor:(a,b)=>a.s.localeCompare(b.s)||b.f-a.f
  }[sortBy];
  return rows.slice().sort(c);
}

/* ---------- urgency strip ---------- */
function strip(){
  const base=pool('urg');
  const g={crit:0,soon:0,range:0,later:0,roll:0,past:0};
  base.forEach(r=>{const b=band(r.do); if(b in g) g[b]++;});
  const defs=[['crit','Closing within 14 days'],['soon','Due within 45 days'],['range','Due within 120 days'],
              ['later','Beyond 120 days'],['roll','Rolling or date not set'],['past','Deadline passed']];
  document.getElementById('strip').innerHTML = defs.map(([k,l])=>
    `<div class="st ${k}" role="button" tabindex="0" data-urg="${k}" aria-pressed="${urg===k}">
       <div class="n">${g[k]}</div><div class="l">${l}</div></div>`).join('');
}

/* ---------- runway ---------- */
function runway(){
  const W=1180,H=190,L=44,R=22,T=26,B=42, iw=W-L-R;
  const t0=new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  const t1=new Date(TODAY.getFullYear(), TODAY.getMonth()+13, 1);
  const span=t1-t0, x=d=>L+((new Date(d)-t0)/span)*iw;
  const rows=pool('month').filter(r=>r.d&&pd(r.d)>=t0&&pd(r.d)<t1);
  const COL={crit:'var(--crit)',soon:'var(--soon)',range:'var(--range)',later:'var(--later)',past:'var(--later)'};
  let s=`<svg class="rw" id="rwsvg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Deadline timeline, ${rows.length} opportunities over the next thirteen months">`;
  // month gridlines + labels
  for(let i=0;i<13;i++){
    const d=new Date(t0.getFullYear(), t0.getMonth()+i, 1), xx=x(d);
    s+=`<line class="gl" x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${H-B}"/>`;
    s+=`<text class="mo" x="${(xx+4).toFixed(1)}" y="${H-B+15}">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}</text>`;
    if(d.getMonth()===0||i===0) s+=`<text x="${(xx+4).toFixed(1)}" y="${H-B+27}">${d.getFullYear()}</text>`;
  }
  s+=`<line class="base" x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}"/>`;
  // today marker
  const tx=x(TODAY);
  s+=`<line x1="${tx.toFixed(1)}" y1="${T-8}" x2="${tx.toFixed(1)}" y2="${H-B}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  s+=`<text x="${(tx+5).toFixed(1)}" y="${T-11}" style="fill:var(--accent);font-weight:600">today</text>`;
  // dots, vertically jittered by fit so high-fit sits high
  const maxA=Math.max(...rows.map(r=>r.amt||0),1);
  rows.forEach((r,i)=>{
    const rad=3+Math.sqrt((r.amt||0)/maxA)*9;
    const y=(H-B)-8-((r.f/140)*(H-B-T-16));
    const b=band(r.do);
    s+=`<circle cx="${x(pd(r.d)).toFixed(1)}" cy="${Math.max(T+4,y).toFixed(1)}" r="${rad.toFixed(1)}"
        fill="${COL[b]||'var(--later)'}" fill-opacity=".62" stroke="${COL[b]||'var(--later)'}" stroke-opacity=".9"
        data-i="${r.idx}"><title>${esc(r.s)} — ${esc(r.p)} · ${fmt(r.d)}</title></circle>`;
  });
  s+=`<text x="${W-R}" y="${T-11}" text-anchor="end">vertical position = fit score</text></svg>`;
  document.getElementById('rw').outerHTML=s;
  document.getElementById('rwsvg').id='rw';
  document.getElementById('rw').classList.add('rw');
}

/* ---------- chips ---------- */
function chips(){
  const forCats=pool('cat'), forFoci=pool('focus');
  document.getElementById('cats').innerHTML = CATS.map(([k,l])=>
    `<button class="chip" data-cat="${k}" aria-pressed="${cats.has(k)}">${l}<span class="c">${forCats.filter(r=>r.c===k).length}</span></button>`).join('');
  document.getElementById('focus').innerHTML = FOCI.map(([k,l])=>
    `<button class="chip" data-focus="${k}" aria-pressed="${foci.has(k)}">${l}<span class="c">${forFoci.filter(r=>r.fo.includes(k)).length}</span></button>`).join('');
}

/* Every active filter gets a visible, removable token. Without this the runway's
   month filter is invisible and unclearable, and a search can silently return nothing. */
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const VLABEL={eligible:'clear','needs-check':'needs a check','track-gated':'track-gated',
              'ruled-out':'ruled out',retired:'retired programs',all:'everything'};
const TLABEL={'early-career':'early career','mid-size':'mid-size investigator','program-large':'program & team science'};
function activebar(){
  const el=document.getElementById('active'); if(!el) return;
  const t=[];
  if(q) t.push(['q','Search',q]);
  if(month) t.push(['month','Month',MON[+month.slice(5,7)-1]+' '+month.slice(0,4)]);
  if(urg) t.push(['urg','Urgency',BANDLABEL[urg]]);
  cats.forEach(c=>t.push(['cat:'+c,'Bucket',(CATS.find(x=>x[0]===c)||[])[1]||c]));
  foci.forEach(f=>t.push(['focus:'+f,'Angle',FLABEL[f]||f]));
  if(tier) t.push(['tier','Tier',TLABEL[tier]||tier]);
  if(verd!=='live') t.push(['verd','Eligibility',VLABEL[verd]||verd]);
  el.hidden = !t.length;
  el.innerHTML = t.length ? '<span class="lab">Filtered by</span>' + t.map(([k,l,v])=>
      `<span class="tok"><span>${esc(l)}: <b>${esc(v)}</b></span>`+
      `<button data-clear="${esc(k)}" aria-label="Remove filter ${esc(l)} ${esc(v)}">&times;</button></span>`).join('')
    + '<button id="clearall">Clear all</button>' : '';
}
function clearAll(){
  q=''; month=null; urg=null; tier=''; verd='live'; cats.clear(); foci.clear();
  document.getElementById('q').value='';
  document.getElementById('tier').value='';
  document.getElementById('verd').value='live';
}
/* The sort <select> and the clickable headers drive the same state; keep them in step. */
const ASC={date:1,sponsor:1};
function syncSort(){
  document.querySelectorAll('th[data-sort]').forEach(th=>{
    const on=th.dataset.sort===sortBy, ar=th.querySelector('.ar');
    if(ar) ar.textContent = on ? (ASC[sortBy]?'▴':'▾') : '';
    th.setAttribute('aria-sort', on ? (ASC[sortBy]?'ascending':'descending') : 'none');
  });
  const sel=document.getElementById('sort');
  if(sel && sel.value!==sortBy) sel.value=sortBy;
}
/* Re-rendering replaces the focused node, which strands keyboard users. Put focus back. */
function keepFocus(fn){
  const a=document.activeElement, d=a&&a.dataset||{};
  const sel = d.urg ? `[data-urg="${d.urg}"]` : d.cat ? `[data-cat="${d.cat}"]`
    : d.focus ? `[data-focus="${d.focus}"]`
    : (a&&a.classList&&a.classList.contains('row')) ? `tr.row[data-i="${d.i}"]` : null;
  fn();
  if(sel){ const n=document.querySelector(sel); if(n) n.focus(); }
}
function redraw(){ strip(); chips(); runway(); wireRunway(); render(); }

/* ---------- table ---------- */
function render(){
  activebar();
  const rows=sortRows(pool());
  document.getElementById('count').textContent = rows.length+' of '+DATA.length;
  const tb=document.getElementById('tb');
  document.getElementById('empty').hidden = rows.length>0;
  tb.innerHTML = rows.map(r=>{
    const i=r.idx, v=resolve(r), b=band(r.do);
    const stripe={crit:'var(--crit)',soon:'var(--soon)',range:'var(--range)',later:'var(--line-strong)',roll:'var(--ok)',past:'var(--line-strong)'}[b];
    // readable text colour; the stripe tint above is decorative and fails contrast at 11px
    const dcol={crit:'var(--crit)',soon:'var(--soon)',range:'var(--range)'}[b] || 'var(--muted)';
    const vpill={eligible:['p-ok','clear'],'needs-check':['p-later','check'],'track-gated':['p-soon','track-gated'],'ruled-out':['p-crit','ruled out']}[v]
      || ['p-later', v||'unknown'];
    const dl = r.d ? `<div class="dl">${fmt(r.d)}</div><div class="days" style="color:${dcol}">${
        r.do<0?Math.abs(r.do)+' days ago':r.do===0?'today':'in '+r.do+' days'}${r.loi&&r.loi===r.d?' · LOI':''}</div>`
      : `<div class="dl" style="color:var(--muted)">${r.cy==='rolling'?'rolling':'not posted'}</div>`;
    let html=`<tr class="row" data-i="${i}" tabindex="0" role="button" aria-expanded="${open.has(i)}">
      <td class="stripe" style="background:${stripe}"></td>
      <td><div class="fitbar"><div class="track"><div class="fill" style="width:${Math.min(100,r.f/1.4).toFixed(0)}%"></div></div><span class="num">${r.f.toFixed(0)}</span></div></td>
      <td class="prog"><div class="pname">${esc(r.p)}</div><div class="psponsor">${esc(r.sf)}</div>
        <div class="tags">${r.bs?'<span class="tag hi">breast-specific</span>':''}${
          r.fit==='high'?'<span class="tag hi">ER+/HER2+</span>':''}${
          r.fo.map(f=>`<span class="tag">${esc(FLABEL[f]||f)}</span>`).join('')}${
          r.lim?'<span class="tag">limited submission</span>':''}${
          r.cf!=='verified'?`<span class="tag">${esc(r.cf)}</span>`:''}</div></td>
      <td>${dl}</td>
      <td><div class="amt">${money(r.amt)}</div>${r.yr?`<div class="days" style="color:var(--faint)">${r.yr} yr</div>`:''}</td>
      <td><span class="pill p-later">${esc((CATS.find(c=>c[0]===r.c)||[])[1]||r.c)}</span></td>
      <td><span class="pill ${vpill[0]}">${vpill[1]}</span></td></tr>`;
    if(open.has(i)) html+=detail(r,v);
    return html;
  }).join('');
}

function detail(r,v){
  const warn = r.cf!=='verified'
    ? `<div class="warn"><b>Date not confirmed.</b> ${r.cf==='projected'
        ? 'Only the previous cycle was found; this date is inferred from that pattern.'
        : 'The sponsor page could not be reached, usually a login wall. The mechanism is real, the timing is not established.'} Open the source before committing effort.</div>` : '';
  const gate = (v==='track-gated'||r.tg)
    ? `<div class="gate"><b>Gated on your appointment track.</b> This award ${esc(r.tg||'depends on track')}. ${
        track==='unknown'?'Set your track in the header to resolve it.':''}</div>` : '';
  const dead = r.st==='retired'
    ? `<div class="warn"><b>This program appears to have stopped.</b> Marked retired on ${fmt(r.ro)||'an earlier refresh'}. ${esc(r.rr||'')} It is kept here rather than deleted so it is not researched again from scratch.</div>` : '';
  const ruled = r.rs.length
    ? `<div class="${v==='ruled-out'?'warn':'gate'}"><b>${v==='ruled-out'?'Screened out:':'Flag:'}</b> ${esc(r.rs.join('; '))}.</div>` : '';
  return `<tr class="detail"><td colspan="7"><div class="dt"><div>
      ${dead}${warn}${gate}${ruled}
      <h4>Eligibility</h4><p>${esc(r.el)}</p>
      ${r.n?`<h4>What to know</h4><p>${esc(r.n)}</p>`:''}
      ${r.ev?`<h4>Source line</h4><p class="ev">${esc(r.ev)}</p>`:''}
      ${r.u?`<h4>Sponsor page</h4><a class="src" href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.u)} ↗</a>`:''}
    </div><div class="facts"><dl>
      <dt>LOI due</dt><dd>${fmt(r.loi)||'none required'}</dd>
      <dt>Full app</dt><dd>${fmt(r.fa)||'—'}</dd>
      <dt>Award</dt><dd>${esc(r.amtx||money(r.amt))}</dd>
      <dt>Duration</dt><dd>${r.yr?r.yr+' years':'—'}</dd>
      <dt>Indirects</dt><dd>${esc(r.ic||'unstated')}</dd>
      <dt>Cycle</dt><dd>${esc(r.cy)}</dd>
      <dt>Stage cap</dt><dd>${esc(r.cap||'none')}</dd>
      <dt>ER+/HER2+</dt><dd>${esc(r.fit)} fit</dd>
      <dt>Confidence</dt><dd>${esc(r.cf)}</dd>
      <dt>Last checked</dt><dd>${fmt(r.lv)||'—'}</dd>
    </dl></div></div></td></tr>`;
}

/* ---------- events ---------- */
document.addEventListener('click', e=>{
  const row=e.target.closest('tr.row');
  if(row && !e.target.closest('a')){ const i=+row.dataset.i; open.has(i)?open.delete(i):open.add(i); render(); return; }
  const st=e.target.closest('.st');
  if(st){ urg = urg===st.dataset.urg ? null : st.dataset.urg; strip(); render(); return; }
  const ch=e.target.closest('[data-cat]');
  if(ch){ cats.has(ch.dataset.cat)?cats.delete(ch.dataset.cat):cats.add(ch.dataset.cat); chips(); render(); return; }
  const cf=e.target.closest('[data-focus]');
  if(cf){ foci.has(cf.dataset.focus)?foci.delete(cf.dataset.focus):foci.add(cf.dataset.focus); chips(); render(); return; }
  const tk=e.target.closest('[data-track]');
  if(tk){ track=tk.dataset.track; PROFILE.track=track; saveProfile(PROFILE);
    document.querySelectorAll('[data-track]').forEach(b=>b.setAttribute('aria-pressed', String(b===tk)));
    strip(); chips(); runway(); wireRunway(); render(); return; }
  const cl=e.target.closest('#changetoggle');
  if(cl){ const pane=document.getElementById('changepane');
    pane.hidden=!pane.hidden; cl.setAttribute('aria-expanded', String(!pane.hidden)); return; }
  const th=e.target.closest('th[data-sort]');
  if(th){ sortBy=th.dataset.sort; syncSort(); render(); return; }
  const rm=e.target.closest('[data-clear]');
  if(rm){ const k=rm.dataset.clear;
    if(k==='q'){ q=''; document.getElementById('q').value=''; }
    else if(k==='month') month=null;
    else if(k==='urg') urg=null;
    else if(k==='tier'){ tier=''; document.getElementById('tier').value=''; }
    else if(k==='verd'){ verd='live'; document.getElementById('verd').value='live'; }
    else if(k.startsWith('cat:')) cats.delete(k.slice(4));
    else if(k.startsWith('focus:')) foci.delete(k.slice(6));
    redraw(); return; }
  if(e.target.closest('#clearall')){ clearAll(); redraw(); return; }
  const nt=e.target.closest('#newtoggle');
  if(nt){ const pane=document.getElementById('newpane');
    pane.hidden=!pane.hidden; nt.setAttribute('aria-expanded', String(!pane.hidden));
    nt.textContent = pane.hidden ? 'Show them' : 'Hide'; return; }
});
document.addEventListener('keydown', e=>{
  if(e.key!=='Enter' && e.key!==' ') return;
  const hit=e.target.closest('.st, tr.row, th[data-sort]');
  if(!hit) return;
  e.preventDefault();            // Space would otherwise scroll the page
  keepFocus(()=>hit.click());
});
document.getElementById('q').addEventListener('input', e=>{ q=e.target.value.trim().toLowerCase(); render(); });
document.getElementById('sort').addEventListener('change', e=>{ sortBy=e.target.value; syncSort(); render(); });
document.getElementById('verd').addEventListener('change', e=>{ verd=e.target.value; render(); });
document.getElementById('tier').addEventListener('change', e=>{ tier=e.target.value; render(); });

const tip=document.getElementById('tip');
function wireRunway(){
  const svg=document.getElementById('rw'); if(!svg) return;
  svg.addEventListener('mousemove', e=>{
    const c=e.target.closest('circle');
    if(!c){ tip.classList.remove('on'); return; }
    const r=DATA[+c.dataset.i];
    tip.innerHTML=`<b>${esc(r.s)}</b> — ${esc(r.p)}<span class="tm">${fmt(r.d)} · ${money(r.amt)} · fit ${r.f.toFixed(0)}</span>`;
    tip.classList.add('on');
    tip.style.left=Math.min(e.clientX+14, innerWidth-290)+'px';
    tip.style.top=(e.clientY+16)+'px';
  });
  svg.addEventListener('mouseleave', ()=>tip.classList.remove('on'));
  svg.addEventListener('click', e=>{
    const c=e.target.closest('circle'); if(!c) return;
    const m=DATA[+c.dataset.i].d.slice(0,7);
    month = month===m ? null : m; render();
    document.querySelector('.tablewrap').scrollIntoView({behavior:'smooth',block:'start'});
  });
}
/* Discovery finds wait here, visible, until the Mon/Thu pass promotes them into the main set. */
function newly(){
  const bar=document.getElementById('newbar'), pane=document.getElementById('newpane');
  if(!bar||!pane) return;
  const n=CANDIDATES.length;
  // blocked/unreachable pages recur every day by design; only substantive signals earn a mention
  const pend=SIGNALS && SIGNALS.signals ? SIGNALS.signals.filter(s=>!['baseline','blocked','unreachable'].includes(s.kind)).length : 0;
  const sl=document.getElementById('sigline');
  if(sl) sl.innerHTML = pend ? `<span class="sigline">${pend} watch signal${pend===1?'':'s'} from the daily crawl on ${esc(fmt(SIGNALS.generated)||SIGNALS.generated)} await the same pass.</span>` : '';
  bar.hidden = !n && !pend;
  document.getElementById('newcount').textContent=n;
  document.getElementById('newnoun').textContent = n===1?'mechanism':'mechanisms';
  if(!n){ pane.innerHTML='<p style="color:var(--muted);font-size:13px;margin:10px 0">Nothing new is waiting.</p>'; return; }
  pane.innerHTML = CANDIDATES.map(x=>{
    const r=x.record||{}, v=x.verification||{}, pv=x.provenance||{};
    const nd = r.next_deadline ? `${fmt(r.next_deadline)} (${days(r.next_deadline)} days)` : (r.deadline_status||'not posted');
    return `<div class="cand"><div>
      <div class="lens">${esc(pv.lens||'discovery')} &middot; found ${esc(fmt(pv.found_on)||pv.found_on||'')} &middot; ${esc(r.confidence||'unverified')}</div>
      <div class="name">${esc(r.program||x.id)}</div>
      <div class="who">${esc(r.sponsor_full||r.sponsor||'')}</div>
      ${r.notes?`<p>${esc(r.notes)}</p>`:''}
      ${r.url?`<a class="src" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)} &#8599;</a>`:''}
    </div><div class="facts"><dl>
      <dt>Next date</dt><dd>${esc(nd)}</dd>
      <dt>Award</dt><dd>${esc(r.award_text||money(r.award_usd))}</dd>
      <dt>Provides</dt><dd>${esc(x.provides||'funding')}</dd>
      <dt>Bucket</dt><dd>${esc((CATS.find(c=>c[0]===r.category)||[])[1]||r.category||'')}</dd>
      <dt>Screen</dt><dd>${esc(r.verdict||'needs-check')}</dd>
      <dt>Verified</dt><dd>${v.real?'real':'?'} &middot; ${v.active?'active':'inactive?'} &middot; ${v.eligible_plausible?'eligible':'eligibility?'}</dd>
    </dl></div></div>`; }).join('');
}

function changelog(){
  const el=document.getElementById('changepane'); if(!el) return;
  const e=CHANGELOG.entries||[];
  document.getElementById('changecount').textContent = e.length ? fmt(e[0].date) : '—';
  el.innerHTML = e.slice(0,14).map(x=>`<div class="cl">
      <div class="cl-d">${fmt(x.date)}</div>
      <div><div class="cl-s">${esc(x.summary)}</div>
      <div class="cl-m">${x.added?`+${x.added} added `:''}${x.changed?`· ${x.changed} changed `:''}${x.retired?`· ${x.retired} retired`:''}</div>
      ${(x.details||[]).length?`<ul class="cl-l">${x.details.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>`:''}
      </div></div>`).join('') || '<p style="color:var(--muted);font-size:13px">No changes recorded yet.</p>';
}

function boot(){
  document.querySelectorAll('[data-track]').forEach(b=>
    b.setAttribute('aria-pressed', String(b.dataset.track===PROFILE.track)));
  const g=document.getElementById('gen'); if(g) g.textContent=fmt(GENERATED)||GENERATED;
  document.querySelectorAll('[data-total]').forEach(n=>n.textContent=DATA.length);
  document.querySelectorAll('[data-generated]').forEach(n=>n.textContent=fmt(GENERATED)||GENERATED);
  syncSort(); redraw(); changelog(); newly();
}

/* no-cache forces revalidation, so a refresh lands immediately instead of sitting
   behind an edge-cached copy. Unchanged files still come back as a cheap 304. */
const GET = u => fetch(u, {cache:'no-cache'}).then(r=>{ if(!r.ok) throw new Error(u+' '+r.status); return r.json(); });
Promise.all([
  GET('data/grants.json'),
  GET('data/changelog.json').catch(()=>({entries:[]})),
  GET('data/candidates.json').catch(()=>({candidates:[]})),
  GET('data/signals.json').catch(()=>null)
]).then(([g,c,k,sg])=>{
  DATA=normalize(g.grants); GENERATED=g.generated; CHANGELOG=c;
  CANDIDATES=(k.candidates||[]).filter(x=>x.decision==='pending'||x.decision==='promote'); SIGNALS=sg; boot();
}).catch(err=>{
  document.getElementById('tb').innerHTML='';
  const e=document.getElementById('empty'); e.hidden=false;
  e.innerHTML='<div class="big">Could not load the dataset</div><div>data/grants.json did not load. If you are opening this file directly from disk, serve it over http instead: <code>python3 -m http.server</code></div>';
  console.error(err);
});
