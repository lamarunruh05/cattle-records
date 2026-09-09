function uid(){return 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}
const STORAGE_KEY="cattleRecordsPrototypeV2";
const initialData={
  farmName:"Fazenda Monte Alegre",currentUser:"",
  cows:[
    {id:uid(),brand:"247",owner:"John",calves:[
      {id:uid(),month:4,year:2024,gender:"Heifer",color:"Red",dead:false},
      {id:uid(),month:4,year:2025,gender:"Bull",color:"Red",dead:false},
      {id:uid(),month:5,year:2026,gender:"Heifer",color:"Red",dead:false}]},
    {id:uid(),brand:"381",owner:"Jack",calves:[
      {id:uid(),month:3,year:2025,gender:"Bull",color:"Black",dead:false},
      {id:uid(),month:6,year:2026,gender:"Heifer",color:"Black",dead:true}]},
    {id:uid(),brand:"412",owner:"",calves:[{id:uid(),month:8,year:2025,gender:"",color:"",dead:false}]},
    {id:uid(),brand:"501",owner:"",calves:[]}
  ],
  notes:[{id:uid(),user:"John",timestamp:new Date(Date.now()-5700000).toISOString(),text:"Cow 247 is in the north pasture.",photo:null}]
};
let state=loadState();
let view={page:state.currentUser?"home":"login",cowId:null,ownerFilter:"",search:""};
let pendingPhoto=null;
const app=document.getElementById("app"),modalRoot=document.getElementById("modalRoot");
function loadState(){try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)return JSON.parse(raw)}catch{}return JSON.parse(JSON.stringify(initialData))}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function currentYear(){return new Date().getFullYear()}
function monthName(m){return new Intl.DateTimeFormat("en",{month:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2020,m-1,1)))}
function fullMonthName(m){return new Intl.DateTimeFormat("en",{month:"long",timeZone:"UTC"}).format(new Date(Date.UTC(2020,m-1,1)))}
function formatDateTime(iso){return new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(iso))}
function shortDate(iso){const d=new Date(iso),n=new Date();if(d.toDateString()===n.toDateString())return new Intl.DateTimeFormat("en",{hour:"numeric",minute:"2-digit"}).format(d);return new Intl.DateTimeFormat("en",{month:"short",day:"numeric"}).format(d)}
function sortedCows(cows){return [...cows].sort((a,b)=>a.brand.localeCompare(b.brand,undefined,{numeric:true,sensitivity:"base"}))}
function sortedCalves(cow){return [...cow.calves].sort((a,b)=>(b.year-a.year)||(b.month-a.month))}
function latestCurrentYearCalf(cow){return sortedCalves(cow).find(c=>Number(c.year)===currentYear())||null}
function monthsApart(a,b){return (b.year-a.year)*12+(b.month-a.month)}
function statsFor(cow){const a=[...cow.calves].sort((x,y)=>(x.year-y.year)||(x.month-y.month)),total=a.length,dead=a.filter(c=>c.dead).length,live=total-dead;let avgInterval=null;if(total>=2){const ints=[];for(let i=1;i<a.length;i++)ints.push(monthsApart(a[i-1],a[i]));avgInterval=ints.reduce((s,n)=>s+n,0)/ints.length}let calvingRate=null;if(total){const first=a[0].year,yearsExpected=Math.max(1,currentYear()-first+1),calvedYears=new Set(a.filter(c=>c.year>=first&&c.year<=currentYear()).map(c=>c.year)).size;calvingRate=calvedYears/yearsExpected*100}return{total,dead,live,survival:total?live/total*100:null,deadRate:total?dead/total*100:null,avgInterval,calvingRate}}
function pct(n){return n==null?"—":`${Math.round(n)}%`}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function attr(v=""){return esc(v).replace(/`/g,"&#096;")}
function usePage(html){app.innerHTML=html;modalRoot.innerHTML=""}
function render(){if(view.page==="login")return renderLogin();if(view.page==="cattle")return renderCattle();if(view.page==="cow")return renderCow();if(view.page==="scorecard")return renderScorecard();if(view.page==="herdScorecard")return renderHerdScorecard();if(view.page==="chat")return renderChat();return renderHome()}
function renderLogin(){usePage(`<main class="screen auth-screen"><section class="auth-card"><p class="eyebrow">Cattle Records</p><h1>Farm login</h1><p class="muted">Enter your username to open the shared farm records.</p><form id="loginForm" class="stack"><label><span>Username</span><input id="usernameInput" maxlength="40" required placeholder="Your name"></label><button class="primary" type="submit">Continue</button></form></section></main>`);document.getElementById("loginForm").addEventListener("submit",e=>{e.preventDefault();const u=document.getElementById("usernameInput").value.trim();if(!u)return;state.currentUser=u;saveState();view.page="home";render()})}
function renderHome(){const latest=[...state.notes].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))[0]||null,calved=state.cows.filter(c=>latestCurrentYearCalf(c)).length,dead=state.cows.filter(c=>(latestCurrentYearCalf(c)&&latestCurrentYearCalf(c).dead)).length;usePage(`<main class="screen"><header class="topbar"><div><p class="eyebrow">Farm</p><h1>${esc(state.farmName||"Cattle Records")}</h1></div><button class="icon-button" id="menuBtn">☰</button></header><section class="home-actions"><button class="home-card" id="openCattle"><div class="home-card-row"><div class="home-card-icon">🐄</div><div class="home-card-copy"><div class="home-card-title">Cattle</div><div class="home-card-sub">${state.cows.length} cows · ${calved} calved this year</div></div><span class="chevron">›</span></div></button><button class="home-card" id="openChat"><div class="home-card-row"><div class="home-card-icon">💬</div><div class="home-card-copy"><div class="home-card-title">Farm Chat</div><div class="home-card-sub">${latest?`${esc(latest.user)}: ${esc(latest.text||"Photo")}`:"No messages yet"}</div></div><div>${latest?`<div class="chat-preview-date">${shortDate(latest.timestamp)}</div>`:""}<span class="chevron">›</span></div></div></button></section><section class="home-summary"><div class="mini-stat"><strong>${state.cows.length}</strong><span>Total cows</span></div><div class="mini-stat"><strong>${calved}</strong><span>Calved ${currentYear()}</span></div><div class="mini-stat"><strong>${dead}</strong><span>Dead calf flags</span></div></section></main>`);document.getElementById("openCattle").onclick=()=>{view.page="cattle";render()};document.getElementById("openChat").onclick=()=>{view.page="chat";render()};document.getElementById("menuBtn").onclick=showFarmMenu}
function renderCattle(){let cows=sortedCows(state.cows);if(view.ownerFilter)cows=cows.filter(c=>c.owner===view.ownerFilter);if(view.search){const q=view.search.trim().toLowerCase();cows=cows.filter(c=>c.brand.toLowerCase().includes(q))}usePage(`<main class="screen"><header class="topbar"><div class="back-title"><button class="icon-button" id="backHome">←</button><h1 class="page-title">Cattle</h1></div><div class="cattle-header-actions"><button class="soft small" id="herdScoreBtn">Scorecard</button><button class="primary small" id="addCowBtn">+ Cow</button></div></header><section class="cattle-tools"><div class="search-wrap"><span class="search-icon">⌕</span><input id="cowSearch" inputmode="numeric" placeholder="Search brand number" value="${attr(view.search)}"></div><button class="soft" id="ownersBtn">Owners</button></section>${view.ownerFilter?`<div class="filter-bar"><span>Owner: ${esc(view.ownerFilter)}</span><button class="link-btn" id="clearOwner">Clear</button></div>`:""}<div class="cattle-count">${cows.length} ${cows.length===1?"cow":"cows"}</div><section class="cattle-grid">${cows.length?cows.map(c=>{const latest=latestCurrentYearCalf(c);return `<button class="cattle-number ${latest&&latest.dead?"dead":""}" data-cow="${c.id}"><span class="cattle-brand">${esc(c.brand)}</span><span class="cattle-calving">${latest?`${monthName(latest.month)} ${latest.year}`:"Hasn't calved yet"}</span></button>`}).join(""):`<div class="empty" style="grid-column:1/-1">No cows found.</div>`}</section></main>`);document.getElementById("backHome").onclick=()=>{view.page="home";render()};document.getElementById("addCowBtn").onclick=showAddCowModal;document.getElementById("herdScoreBtn").onclick=()=>{view.page="herdScorecard";render()};document.getElementById("ownersBtn").onclick=showOwnersModal;if(view.ownerFilter)document.getElementById("clearOwner").onclick=()=>{view.ownerFilter="";render()};document.getElementById("cowSearch").addEventListener("input",e=>{view.search=e.target.value;renderCattle();const i=document.getElementById("cowSearch");i.focus();i.setSelectionRange(i.value.length,i.value.length)});document.querySelectorAll("[data-cow]").forEach(b=>b.onclick=()=>{view.cowId=b.dataset.cow;view.page="cow";render()})}
function renderCow(){const cow=state.cows.find(c=>c.id===view.cowId);if(!cow){view.page="cattle";return render()}const calves=sortedCalves(cow);usePage(`<main class="screen"><header class="topbar"><button class="icon-button" id="backCattle">←</button><button class="icon-button" id="cowMenuBtn">•••</button></header><section class="cow-head"><div class="cow-head-row"><div><p class="eyebrow">Brand number</p><div class="brand-number">${esc(cow.brand)}</div></div></div><label class="inline-field"><span>Owner</span><input id="ownerInput" maxlength="80" placeholder="Optional" value="${attr(cow.owner||"")}"></label></section><section><div class="section-heading"><div><p class="eyebrow">History</p><h2>Calves</h2></div><button class="primary small" id="addCalfBtn">+ Calf</button></div><div class="calf-list">${calves.length?calves.map(c=>{const meta=[c.gender,c.color].filter(Boolean).join(" · ");return `<button class="calf-card" data-calf="${c.id}"><div class="calf-top"><span class="calf-date">${fullMonthName(c.month)} ${c.year}</span>${c.dead?`<span class="dead-badge">Died</span>`:""}</div><div class="calf-meta">${meta||"No extra information"}</div></button>`}).join(""):`<div class="empty">No calf records yet.</div>`}</div><button class="scorecard-link" id="scorecardBtn"><span>View performance scorecard</span><span>›</span></button></section></main>`);document.getElementById("backCattle").onclick=()=>{view.page="cattle";render()};document.getElementById("ownerInput").onchange=e=>{cow.owner=e.target.value.trim();saveState()};document.getElementById("addCalfBtn").onclick=()=>showCalfModal(cow,null);document.getElementById("scorecardBtn").onclick=()=>{view.page="scorecard";render()};document.getElementById("cowMenuBtn").onclick=()=>showCowMenu(cow);document.querySelectorAll("[data-calf]").forEach(b=>{const calf=cow.calves.find(c=>c.id===b.dataset.calf);b.onclick=()=>showCalfModal(cow,calf)})}

function herdStatsForYear(year){
  const eligible=state.cows.filter(c=>{
    if(!c.calves||!c.calves.length)return false;
    return Math.min(...c.calves.map(x=>Number(x.year)))<=year;
  });
  const calved=eligible.filter(c=>c.calves.some(x=>Number(x.year)===year));
  const calves=eligible.flatMap(c=>c.calves.filter(x=>Number(x.year)===year));
  const dead=calves.filter(x=>x.dead).length,live=calves.length-dead;
  return{year,eligible:eligible.length,calved:calved.length,calves:calves.length,live,dead,
    calvingRate:eligible.length?calved.length/eligible.length*100:null,
    notCalvedRate:eligible.length?(eligible.length-calved.length)/eligible.length*100:null,
    survival:calves.length?live/calves.length*100:null,
    deadRate:calves.length?dead/calves.length*100:null};
}
function renderHerdScorecard(){
  const firstYears=state.cows.filter(c=>c.calves&&c.calves.length).map(c=>Math.min(...c.calves.map(x=>Number(x.year))));
  const firstYear=firstYears.length?Math.min(...firstYears):currentYear();
  const rows=Array.from({length:Math.max(1,currentYear()-firstYear+1)},(_,i)=>herdStatsForYear(firstYear+i));
  const now=herdStatsForYear(currentYear());
  usePage(`<main class="screen">
    <header class="topbar"><div class="back-title"><button class="icon-button" id="backCattle">←</button><div><p class="eyebrow">${esc(state.farmName||"Farm")}</p><h1 class="page-title">Herd Scorecard</h1></div></div></header>
    <p class="score-year-label">${currentYear()} herd results</p>
    <section class="score-summary">
      <div class="score-summary-card"><strong>${pct(now.calvingRate)}</strong><span>Calving rate</span></div>
      <div class="score-summary-card"><strong>${pct(now.notCalvedRate)}</strong><span>Not calved yet</span></div>
      <div class="score-summary-card"><strong>${pct(now.survival)}</strong><span>Calf survival</span></div>
      <div class="score-summary-card"><strong>${pct(now.deadRate)}</strong><span>Dead calf rate</span></div>
      <div class="score-summary-card"><strong>${now.eligible}</strong><span>Eligible cows</span></div>
      <div class="score-summary-card"><strong>${now.calves}</strong><span>Calves recorded</span></div>
    </section>
    <div class="herd-table-wrap"><table class="herd-score-table">
      <thead><tr><th>Year</th><th>Eligible</th><th>Calved</th><th>Calving %</th><th>Live</th><th>Dead</th><th>Dead %</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${r.year}</td><td>${r.eligible}</td><td>${r.calved}</td><td>${pct(r.calvingRate)}</td><td class="status-live">${r.live}</td><td class="${r.dead?"status-dead":""}">${r.dead}</td><td>${pct(r.deadRate)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="herd-score-note">A cow starts counting in the year of her first recorded calf and remains eligible in each following year.</p>
  </main>`);
  document.getElementById("backCattle").onclick=()=>{view.page="cattle";render()};
}
function renderScorecard(){
  const cow=state.cows.find(c=>c.id===view.cowId);
  if(!cow){view.page="cattle";return render()}
  const s=statsFor(cow);
  const asc=[...cow.calves].sort((a,b)=>(a.year-b.year)||(a.month-b.month));
  const years=asc.length
    ? Array.from({length:currentYear()-asc[0].year+1},(_,i)=>asc[0].year+i)
    : [currentYear()];

  let prev=null;
  const rows=years.map(year=>{
    const yc=asc.filter(c=>c.year===year);
    const first=yc[0]||null;
    let interval="—";
    if(first&&prev) interval=`${monthsApart(prev,first)} mo`;
    if(first) prev=yc[yc.length-1];
    const dead=yc.some(c=>c.dead);
    return {
      year,
      birth:first?`${monthName(first.month)} ${first.year}`:"—",
      result:first?(dead?"Dead":"Live"):"—",
      interval
    };
  });

  usePage(`<main class="screen">
    <header class="topbar">
      <div class="back-title">
        <button class="icon-button" id="backCow">←</button>
        <div>
          <p class="eyebrow">Cow ${esc(cow.brand)}</p>
          <h1 class="page-title">Scorecard</h1>
        </div>
      </div>
    </header>

    <section class="score-summary">
      <div class="score-summary-card"><strong>${pct(s.calvingRate)}</strong><span>Calving rate</span></div>
      <div class="score-summary-card"><strong>${pct(s.survival)}</strong><span>Calf survival</span></div>
      <div class="score-summary-card"><strong>${pct(s.deadRate)}</strong><span>Dead calf rate</span></div>
      <div class="score-summary-card"><strong>${s.avgInterval==null?"—":s.avgInterval.toFixed(1)+" mo"}</strong><span>Avg. calving interval</span></div>
    </section>

    <div class="score-table-wrap">
      <table class="score-table">
        <thead>
          <tr>
            <th>Year</th>
            <th>Birth</th>
            <th>Result</th>
            <th>Interval</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>`<tr>
            <td>${r.year}</td>
            <td>${r.birth}</td>
            <td class="${r.result==="Dead"?"status-dead":r.result==="Live"?"status-live":""}">${r.result}</td>
            <td>${r.interval}</td>
          </tr>`).join("")}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <td>${s.total} calves</td>
            <td>${s.live} live · ${s.dead} dead</td>
            <td>${s.avgInterval==null?"—":s.avgInterval.toFixed(1)+" mo avg"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </main>`);
  document.getElementById("backCow").onclick=()=>{view.page="cow";render()}
}
function renderChat(){
  const notes=[...state.notes].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  usePage(`<main class="screen chat-screen">
    <header class="topbar chat-header">
      <div class="back-title">
        <button class="icon-button" id="backHome">←</button>
        <div>
          <p class="eyebrow">${esc(state.farmName||"Farm")}</p>
          <h1 class="page-title">Farm Chat</h1>
        </div>
      </div>
    </header>

    <section class="chat-list" id="chatList">
      ${notes.length?notes.map(n=>`<div class="message-row ${n.user===state.currentUser?"me":""}">
        <article class="message-bubble">
          <div class="message-meta">${esc(n.user)} · ${formatDateTime(n.timestamp)}</div>
          ${n.text?`<div class="message-text">${esc(n.text)}</div>`:""}
          ${n.photo?`<img src="${n.photo}" alt="Farm chat photo">`:""}
        </article>
      </div>`).join(""):`<div class="empty">No messages yet.</div>`}
    </section>

    <section class="chat-composer">
      <form id="chatForm" class="chat-compose-box">
        <textarea id="chatText" rows="2" maxlength="500" placeholder="Message"></textarea>
        <div class="composer-row">
          <label class="photo-button">
            <input id="chatPhoto" type="file" accept="image/*">
            <span>📷 Photo</span>
          </label>
          <button class="primary small" type="submit">Send</button>
        </div>
        <div id="photoPreviewWrap" class="photo-preview-wrap hidden">
          <img id="photoPreview" alt="Selected photo preview">
          <button type="button" class="link-btn" id="removePhoto">Remove photo</button>
        </div>
      </form>
    </section>
  </main>`);
  document.getElementById("backHome").onclick=()=>{view.page="home";render()};
  setupChatComposer();
  const list=document.getElementById("chatList");
  if(list) list.scrollTop=list.scrollHeight;
}
function setupChatComposer(){const input=document.getElementById("chatPhoto"),wrap=document.getElementById("photoPreviewWrap"),img=document.getElementById("photoPreview");input.onchange=()=>{const f=input.files?.[0];if(!f)return;if(f.size>4*1024*1024){alert("For this prototype, choose an image under 4 MB.");input.value="";return}const r=new FileReader();r.onload=()=>{pendingPhoto=String(r.result);img.src=pendingPhoto;wrap.classList.remove("hidden")};r.readAsDataURL(f)};document.getElementById("removePhoto").onclick=()=>{pendingPhoto=null;input.value="";img.removeAttribute("src");wrap.classList.add("hidden")};document.getElementById("chatForm").onsubmit=e=>{e.preventDefault();const text=document.getElementById("chatText").value.trim();if(!text&&!pendingPhoto)return;state.notes.push({id:uid(),user:state.currentUser,timestamp:new Date().toISOString(),text,photo:pendingPhoto});pendingPhoto=null;saveState();render()}}
function openModal(html,onReady){modalRoot.innerHTML=`<div class="modal-backdrop"><section class="modal">${html}</section></div>`;const b=modalRoot.querySelector(".modal-backdrop");b.onclick=e=>{if(e.target===b)closeModal()};onReady?.()}
function closeModal(){modalRoot.innerHTML=""}
function showOwnersModal(){const owners=[...new Set(state.cows.map(c=>c.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b));openModal(`<div class="modal-card"><div class="section-heading"><div><p class="eyebrow">Filter cattle</p><h2>Owners</h2></div><button class="icon-button" id="closeModal">×</button></div><div class="owner-list">${owners.length?owners.map(o=>`<button class="owner-choice" data-owner="${attr(o)}">${esc(o)}</button>`).join(""):`<div class="empty">No owners yet.</div>`}</div></div>`,()=>{document.getElementById("closeModal").onclick=closeModal;modalRoot.querySelectorAll("[data-owner]").forEach(b=>b.onclick=()=>{view.ownerFilter=b.dataset.owner;closeModal();render()})})}
function showAddCowModal(){openModal(`<form class="modal-card" id="addCowForm"><p class="eyebrow">New cow</p><h2>Add brand number</h2><div class="stack"><label><span>Brand number</span><input id="newBrand" required maxlength="30" inputmode="numeric"></label><label><span>Owner</span><input id="newOwner" maxlength="80" placeholder="Optional"></label></div><div class="modal-actions"><button type="button" class="soft" id="cancelCow">Cancel</button><button type="submit" class="primary">Add cow</button></div></form>`,()=>{document.getElementById("cancelCow").onclick=closeModal;document.getElementById("addCowForm").onsubmit=e=>{e.preventDefault();const brand=document.getElementById("newBrand").value.trim(),owner=document.getElementById("newOwner").value.trim();if(!brand)return;if(state.cows.some(c=>c.brand.toLowerCase()===brand.toLowerCase())){alert("That brand number already exists.");return}state.cows.push({id:uid(),brand,owner,calves:[]});saveState();closeModal();render()}})}
function showCalfModal(cow,calf){
  const editing=!!calf;
  const current=calf||{
    month:new Date().getMonth()+1,
    year:currentYear(),
    gender:"",
    color:"",
    dead:false,
    notes:""
  };

  openModal(`<form class="modal-card" id="calfForm">
    <p class="eyebrow">${editing?"Edit calf":"New calf"}</p>
    <h2>${editing?"Calf record":"Add calf to "+esc(cow.brand)}</h2>

    <div class="stack">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label>
          <span>Month</span>
          <select id="calfMonth">
            ${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}" ${m===Number(current.month)?"selected":""}>${fullMonthName(m)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Year</span>
          <input id="calfYear" type="number" min="1900" max="2200" value="${current.year}" required>
        </label>
      </div>

      <label>
        <span>Gender</span>
        <select id="calfGender">
          <option value="">Optional</option>
          <option ${current.gender==="Heifer"?"selected":""}>Heifer</option>
          <option ${current.gender==="Bull"?"selected":""}>Bull</option>
        </select>
      </label>

      <label>
        <span>Color</span>
        <input id="calfColor" maxlength="60" value="${attr(current.color||"")}" placeholder="Optional">
      </label>

      <label class="checkbox-row">
        <input id="calfDead" type="checkbox" ${current.dead?"checked":""}>
        <span>${editing&&!current.dead?"Mark as died":"Dead calf"}</span>
      </label>

      <label>
        <span>Notes</span>
        <textarea id="calfNotes" rows="4" maxlength="1000" placeholder="Optional — reason of death, observations, etc.">${esc(current.notes||"")}</textarea>
      </label>
    </div>

    <div class="modal-actions">
      ${editing?`<button type="button" class="danger" id="deleteCalf">Delete</button>`:""}
      <button type="button" class="soft" id="cancelCalf">Cancel</button>
      <button type="submit" class="primary">${editing?"Save":"Add calf"}</button>
    </div>
  </form>`,()=>{
    document.getElementById("cancelCalf").onclick=closeModal;

    if(editing) document.getElementById("deleteCalf").onclick=()=>{
      if(!confirm("Delete this calf record?")) return;
      cow.calves=cow.calves.filter(c=>c.id!==calf.id);
      saveState();
      closeModal();
      render();
    };

    document.getElementById("calfForm").onsubmit=e=>{
      e.preventDefault();
      const record={
        id:editing?calf.id:uid(),
        month:Number(document.getElementById("calfMonth").value),
        year:Number(document.getElementById("calfYear").value),
        gender:document.getElementById("calfGender").value,
        color:document.getElementById("calfColor").value.trim(),
        dead:document.getElementById("calfDead").checked,
        notes:document.getElementById("calfNotes").value.trim()
      };
      if(editing) Object.assign(calf,record);
      else cow.calves.push(record);
      saveState();
      closeModal();
      render();
    };
  });
}
function showFarmMenu(){openModal(`<div class="modal-card"><div class="section-heading"><div><p class="eyebrow">Account</p><h2>${esc(state.currentUser)}</h2></div><button class="icon-button" id="closeMenu">×</button></div><div class="menu-list"><button class="soft" id="farmProfile">Farm profile</button><button class="soft" id="logout">Log out</button></div></div>`,()=>{document.getElementById("closeMenu").onclick=closeModal;document.getElementById("farmProfile").onclick=showFarmProfile;document.getElementById("logout").onclick=()=>{state.currentUser="";saveState();closeModal();view.page="login";render()}})}
function showFarmProfile(){openModal(`<form class="modal-card" id="farmProfileForm"><p class="eyebrow">Settings</p><h2>Farm profile</h2><div class="stack"><label><span>Farm name</span><input id="farmNameInput" maxlength="100" value="${attr(state.farmName||"")}"></label></div><div class="modal-actions"><button type="button" class="soft" id="cancelFarm">Cancel</button><button type="submit" class="primary">Save</button></div></form>`,()=>{document.getElementById("cancelFarm").onclick=closeModal;document.getElementById("farmProfileForm").onsubmit=e=>{e.preventDefault();state.farmName=document.getElementById("farmNameInput").value.trim()||"Cattle Records";saveState();closeModal();render()}})}
function showCowMenu(cow){openModal(`<div class="modal-card"><p class="eyebrow">Cow ${esc(cow.brand)}</p><h2>Options</h2><div class="menu-list" style="margin-top:14px"><button class="danger" id="deleteCow">Delete cow</button><button class="soft" id="closeCowMenu">Cancel</button></div></div>`,()=>{document.getElementById("closeCowMenu").onclick=closeModal;document.getElementById("deleteCow").onclick=()=>{if(!confirm(`Delete cow ${cow.brand} and all calf records?`))return;state.cows=state.cows.filter(c=>c.id!==cow.id);saveState();closeModal();view.page="cattle";render()}})}
try{render()}catch(err){
  console.error(err);
  const a=document.getElementById("app");
  if(a)a.innerHTML='<main class="screen"><section class="auth-card"><p class="eyebrow">Cattle Records</p><h2>App could not start</h2><p class="muted">Please refresh the page. If this message remains, send a screenshot.</p></section></main>';
}
