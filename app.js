import { createAuthClient } from "https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle";

const NEON_AUTH_URL="https://ep-lively-breeze-acpy4xfq.neonauth.sa-east-1.aws.neon.tech/neondb/auth";
const authClient=createAuthClient(NEON_AUTH_URL);
let authSession=null;
let deferredInstallPrompt=null;
const isStandalone=()=>window.matchMedia?.("(display-mode: standalone)")?.matches||window.navigator.standalone===true;
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;});

function uid(){return 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}
const STORAGE_KEY="cattleRecordsPrototypeV2";
const API_BASE="https://cattle-records-api.lamarunruh0.workers.dev";
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
if(!Array.isArray(state.owners))state.owners=[];
let view={page:"login",cowId:null,ownerFilter:"",search:""};
let pendingPhoto=null;
let activityEntries=[];
let activityLoaded=false;
let activityError="";
let activitySyncInFlight=null;
const chatPhotoUrls=new Map();
const chatPhotoLoads=new Map();
const app=document.getElementById("app"),modalRoot=document.getElementById("modalRoot");
function loadState(){try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)return JSON.parse(raw)}catch{}return JSON.parse(JSON.stringify(initialData))}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
let cattleSyncInFlight=null;
let ownersSyncInFlight=null;
async function syncOwnersFromNeon({rerender=false}={}){
  if(ownersSyncInFlight)return ownersSyncInFlight;
  ownersSyncInFlight=(async()=>{
    try{
      const response=await apiFetch("/api/owners",{headers:{Accept:"application/json"},cache:"no-store"});
      const data=await response.json();
      if(!response.ok||!data.ok||!Array.isArray(data.owners))throw new Error(data.error||data.message||"Could not load owners");
      state.owners=data.owners.map(o=>({id:o.id,name:String(o.name)}));
      saveState();
      if(rerender&&view.page!=="login")render();
      return true;
    }catch(err){console.error("Could not sync owners from Neon",err);return false}
    finally{ownersSyncInFlight=null}
  })();
  return ownersSyncInFlight;
}
function ownerById(id){return state.owners.find(o=>String(o.id)===String(id))||null}
async function ensureOwnerByName(name){
  const clean=String(name||"").trim();
  if(!clean)return null;
  let owner=state.owners.find(o=>o.name.toLowerCase()===clean.toLowerCase());
  if(owner)return owner;
  const response=await apiFetch("/api/owners",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:clean})});
  const data=await response.json();
  if(response.status===409){await syncOwnersFromNeon();return state.owners.find(o=>o.name.toLowerCase()===clean.toLowerCase())||null}
  if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not save owner");
  owner={id:data.owner.id,name:String(data.owner.name)};state.owners.push(owner);saveState();return owner;
}
async function syncCowsFromNeon({rerender=true}={}){
  if(cattleSyncInFlight)return cattleSyncInFlight;
  cattleSyncInFlight=(async()=>{
    try{
      await syncOwnersFromNeon();
      const [cowsResponse,calvesResponse]=await Promise.all([
        apiFetch("/api/cows",{headers:{Accept:"application/json"},cache:"no-store"}),
        apiFetch("/api/calves",{headers:{Accept:"application/json"},cache:"no-store"})
      ]);
      const [cowsData,calvesData]=await Promise.all([cowsResponse.json(),calvesResponse.json()]);
      if(!cowsResponse.ok||!cowsData.ok||!Array.isArray(cowsData.cows))throw new Error(cowsData.error||cowsData.message||"Could not load cattle");
      if(!calvesResponse.ok||!calvesData.ok||!Array.isArray(calvesData.calves))throw new Error(calvesData.error||calvesData.message||"Could not load calves");
      const localById=new Map(state.cows.map(c=>[String(c.id),c]));
      const localByBrand=new Map(state.cows.map(c=>[String(c.brand).trim().toLowerCase(),c]));
      const calvesByCow=new Map();
      for(const dbCalf of calvesData.calves){
        const key=String(dbCalf.cow_id);
        if(!calvesByCow.has(key))calvesByCow.set(key,[]);
        calvesByCow.get(key).push({
          id:dbCalf.id,
          month:Number(dbCalf.birth_month),
          year:Number(dbCalf.birth_year),
          gender:appGender(dbCalf.gender),
          color:dbCalf.color||"",
          dead:Boolean(dbCalf.is_dead),
          notes:dbCalf.notes||"",
          createdBy:dbCalf.created_by||"",
          createdAt:dbCalf.created_at||null,
          updatedAt:dbCalf.updated_at||null
        });
      }
      state.cows=cowsData.cows.map(dbCow=>{
        const local=localById.get(String(dbCow.id))||localByBrand.get(String(dbCow.brand_number).trim().toLowerCase());
        return{
          id:dbCow.id,
          brand:String(dbCow.brand_number),
          ownerId:dbCow.owner_id||null,
          owner:ownerById(dbCow.owner_id)?.name||"",
          calves:calvesByCow.get(String(dbCow.id))||[],
          notes:dbCow.notes??local?.notes??"",
          createdBy:dbCow.created_by||local?.createdBy||"",
          createdAt:dbCow.created_at||local?.createdAt||null,
          updatedAt:dbCow.updated_at||local?.updatedAt||null
        };
      });
      saveState();
      if(rerender&&view.page!=="login")render();
      return true;
    }catch(err){
      console.error("Could not sync cattle from Neon",err);
      return false;
    }finally{cattleSyncInFlight=null}
  })();
  return cattleSyncInFlight;
}
async function getAuthSession(){
  let result;
  try{result=await authClient.getSession();}
  catch(err){throw new Error(`SESSION CHECK failed: ${err?.message||err}`);}
  if(result?.error)throw new Error(`SESSION CHECK failed: ${result.error.message||"Could not read authentication session"}`);
  return result?.data||null;
}
async function getAuthToken(session=null){
  // Neon Auth injects the signed JWT into data.session.token on getSession().
  // Reuse that session instead of making a second JWT endpoint request.
  let current=session;
  if(!current){
    try{current=await getAuthSession();}
    catch(err){throw new Error(`JWT SESSION READ failed: ${err?.message||err}`);}
  }
  const token=current?.session?.token;
  if(!(typeof token==="string"&&token.trim())){
    throw new Error("JWT SESSION TOKEN missing: signed-in session has no session.token.");
  }
  return token.trim();
}
async function apiFetch(path,options={}){
  const token=await getAuthToken(authSession);
  const headers=new Headers(options.headers||{});
  headers.set("Authorization",`Bearer ${token}`);
  if(!headers.has("Accept"))headers.set("Accept","application/json");
  return fetch(`${API_BASE}${path}`,{...options,headers});
}
async function syncActivityFromNeon({rerender=true}={}){
  if(activitySyncInFlight)return activitySyncInFlight;
  activityError="";
  activitySyncInFlight=(async()=>{
    try{
      const response=await apiFetch("/api/activity",{headers:{Accept:"application/json"},cache:"no-store"});
      const data=await response.json();
      if(!response.ok||!data.ok||!Array.isArray(data.activity))throw new Error(data.error||data.message||"Could not load activity");
      activityEntries=data.activity.map(item=>({
        id:item.id,
        user:item.display_name||"User",
        entityType:item.entity_type||"record",
        entityId:item.entity_id||null,
        action:item.action||"updated",
        description:item.description||"Farm record changed",
        details:item.details||null,
        createdAt:item.created_at
      }));
      activityLoaded=true;
      activityError="";
      if(rerender&&view.page==="activity")renderActivity();
      return true;
    }catch(err){
      console.error("Could not sync activity from Neon",err);
      activityLoaded=true;
      activityError=err?.message||"Could not load activity";
      if(rerender&&view.page==="activity")renderActivity();
      return false;
    }finally{activitySyncInFlight=null}
  })();
  return activitySyncInFlight;
}
function releaseChatPhotoUrl(messageId){
  const id=String(messageId);
  const url=chatPhotoUrls.get(id);
  if(url){
    URL.revokeObjectURL(url);
    chatPhotoUrls.delete(id);
  }
  chatPhotoLoads.delete(id);
}
async function getChatPhotoUrl(messageId){
  const id=String(messageId);
  if(chatPhotoUrls.has(id))return chatPhotoUrls.get(id);
  if(chatPhotoLoads.has(id))return chatPhotoLoads.get(id);
  const load=(async()=>{
    const response=await apiFetch(`/api/media/${encodeURIComponent(id)}`,{cache:"no-store"});
    if(!response.ok){
      let detail="Could not load photo";
      try{const data=await response.json();detail=data.error||data.message||detail}catch{}
      throw new Error(detail);
    }
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    chatPhotoUrls.set(id,url);
    return url;
  })();
  chatPhotoLoads.set(id,load);
  try{return await load}
  finally{chatPhotoLoads.delete(id)}
}
function hydrateChatPhotos(root=document){
  root.querySelectorAll("img[data-chat-media-id]").forEach(img=>{
    const id=img.dataset.chatMediaId;
    if(!id||img.dataset.loaded==="1")return;
    img.dataset.loaded="loading";
    getChatPhotoUrl(id).then(url=>{
      if(!img.isConnected)return;
      img.src=url;
      img.hidden=false;
      img.dataset.loaded="1";
      const wrap=img.closest("[data-photo-shell]");
      wrap?.classList.add("photo-ready");
    }).catch(err=>{
      console.error("Could not load chat photo",err);
      if(!img.isConnected)return;
      img.dataset.loaded="error";
      const wrap=img.closest("[data-photo-shell]");
      if(wrap){
        wrap.classList.add("photo-error");
        const loading=wrap.querySelector(".chat-photo-loading");
        if(loading)loading.textContent="Photo unavailable";
      }
    });
  });
}
async function prepareChatPhoto(file){
  if(!file||!String(file.type||"").startsWith("image/"))throw new Error("Please choose an image.");
  const allowed=new Set(["image/jpeg","image/png","image/webp"]);
  const maxBytes=8*1024*1024;
  const maxDimension=1800;
  const makeBitmap=async()=>{
    try{return await createImageBitmap(file,{imageOrientation:"from-image"})}
    catch{return await createImageBitmap(file)}
  };
  try{
    const bitmap=await makeBitmap();
    const scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:false});
    ctx.drawImage(bitmap,0,0,width,height);
    bitmap.close?.();
    const toJpeg=quality=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not prepare photo")),"image/jpeg",quality));
    let blob=await toJpeg(.82);
    if(blob.size>maxBytes)blob=await toJpeg(.68);
    if(blob.size>maxBytes)throw new Error("Photo is still larger than 8 MB after compression.");
    if(allowed.has(file.type)&&file.size<=maxBytes&&file.size<=blob.size)return file;
    return new File([blob],`farm-photo-${Date.now()}.jpg`,{type:"image/jpeg"});
  }catch(err){
    if(allowed.has(file.type)&&file.size>0&&file.size<=maxBytes)return file;
    throw new Error(err?.message||"This image format could not be prepared. Try a JPEG, PNG, or WebP photo.");
  }
}
function authDisplayName(session){
  return String(session?.user?.name||session?.user?.email||"").trim();
}
async function testWorkerAuth(session=null){
  const token=await getAuthToken(session);
  if(!token)throw new Error("Neon Auth did not return a JWT for this session.");
  let response;
  try{
    response=await fetch(`${API_BASE}/auth-test`,{
      headers:{Accept:"application/json",Authorization:`Bearer ${token}`},
      cache:"no-store"
    });
  }catch(err){throw new Error(`WORKER /auth-test failed to connect: ${err?.message||err}`);}
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw new Error(`WORKER /auth-test returned HTTP ${response.status}: ${data.error||data.message||"No error message"}`);
  return data;
}
async function bootstrapAuth(){
  const url=new URL(window.location.href);
  const resetToken=url.searchParams.get("token");
  const resetMode=url.searchParams.get("reset")==="1";
  const resetError=resetMode?url.searchParams.get("error"):null;
  if(resetToken){view.page="resetPassword";renderResetPassword(resetToken);return;}
  if(resetMode&&resetError){view.page="login";renderLogin(`Password reset link error: ${resetError}`);return;}

  // Old OAuth/error query strings can remain in a bookmarked GitHub Pages URL.
  // They must never override a valid saved Neon Auth session on refresh.
  const staleAuthKeys=["error","error_description","code","state","reset"];
  let cleaned=false;
  for(const key of staleAuthKeys){if(url.searchParams.has(key)){url.searchParams.delete(key);cleaned=true;}}
  if(cleaned){
    const cleanUrl=url.pathname+(url.searchParams.toString()?`?${url.searchParams}`:"")+url.hash;
    history.replaceState({},"",cleanUrl);
  }

  renderAuthLoading();
  try{
    const session=await getAuthSession();
    if(!session?.user){
      state.currentUser="";
      saveState();
      view.page="login";
      render();
      return;
    }
    await testWorkerAuth(session);
    authSession=session;
    state.currentUser=authDisplayName(session);
    saveState();
    view.page="home";
    render();
    syncCowsFromNeon();
    syncMessagesFromNeon({rerender:false});
  }catch(err){
    console.error("Authentication startup check failed",err);
    authSession=null;
    state.currentUser="";
    saveState();
    view.page="login";
    renderLogin(err.message||"Could not verify authentication");
  }
}
function renderAuthLoading(){
  usePage(`<main class="screen auth-screen"><section class="auth-card auth-loading-card"><p class="eyebrow">Cattle Records</p><h1>Opening farm…</h1><p class="muted">Restoring your saved sign-in.</p><div class="auth-loading-dots" aria-label="Loading"><span></span><span></span><span></span></div></section></main>`);
}

function currentYear(){return new Date().getFullYear()}
function appGender(v){const g=String(v||"").trim().toLowerCase();if(g==="male"||g==="bull")return "Bull";if(g==="female"||g==="heifer")return "Heifer";return ""}
function monthName(m){return new Intl.DateTimeFormat("en",{month:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2020,m-1,1)))}
function fullMonthName(m){return new Intl.DateTimeFormat("en",{month:"long",timeZone:"UTC"}).format(new Date(Date.UTC(2020,m-1,1)))}
function formatDateTime(iso){return new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(iso))}
function shortDate(iso){const d=new Date(iso),n=new Date();if(d.toDateString()===n.toDateString())return new Intl.DateTimeFormat("en",{hour:"numeric",minute:"2-digit"}).format(d);return new Intl.DateTimeFormat("en",{month:"short",day:"numeric"}).format(d)}
function sortedCows(cows){return [...cows].sort((a,b)=>a.brand.localeCompare(b.brand,undefined,{numeric:true,sensitivity:"base"}))}
function sortedCalves(cow){return [...(cow?.calves||[])].sort((a,b)=>(Number(b.year)-Number(a.year))||(Number(b.month)-Number(a.month)))}
function latestCurrentYearCalf(cow){return sortedCalves(cow).find(c=>Number(c.year)===currentYear())||null}
function monthsApart(a,b){return (b.year-a.year)*12+(b.month-a.month)}
function statsFor(cow){const a=[...cow.calves].sort((x,y)=>(x.year-y.year)||(x.month-y.month)),total=a.length,dead=a.filter(c=>c.dead).length,live=total-dead;let avgInterval=null;if(total>=2){const ints=[];for(let i=1;i<a.length;i++)ints.push(monthsApart(a[i-1],a[i]));avgInterval=ints.reduce((s,n)=>s+n,0)/ints.length}let calvingRate=null;if(total){const first=a[0].year,yearsExpected=Math.max(1,currentYear()-first+1),calvedYears=new Set(a.filter(c=>c.year>=first&&c.year<=currentYear()).map(c=>c.year)).size;calvingRate=calvedYears/yearsExpected*100}return{total,dead,live,survival:total?live/total*100:null,deadRate:total?dead/total*100:null,avgInterval,calvingRate}}
function pct(n){return n==null?"—":`${Math.round(n)}%`}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function attr(v=""){return esc(v).replace(/`/g,"&#096;")}
function usePage(html){
  document.body.classList.toggle("cow-layout",html.includes('class="cow-page-fixed"'));
  document.body.classList.toggle("chat-layout",html.includes('class="screen chat-screen"'));
  document.body.classList.toggle("home-layout",html.includes('class="screen home-screen"'));
  app.innerHTML=html;
  modalRoot.innerHTML="";
}
function render(){if(view.page==="login")return renderLogin();if(view.page==="forgotPassword")return renderForgotPassword();if(view.page==="resetPassword")return renderResetPassword(new URLSearchParams(window.location.search).get("token")||"");if(view.page==="cattle")return renderCattle();if(view.page==="cow")return renderCow();if(view.page==="scorecard")return renderScorecard();if(view.page==="herdScorecard")return renderHerdScorecard();if(view.page==="chat")return renderChat();if(view.page==="activity")return renderActivity();return renderHome()}
function renderLogin(errorMessage=""){
  usePage(`<main class="screen auth-screen"><section class="auth-card"><p class="eyebrow">Cattle Records</p><h1>Farm login</h1><p class="muted">Sign in with your farm account.</p>${errorMessage?`<p class="auth-error">${esc(errorMessage)}</p>`:""}<form class="stack" id="emailLoginForm"><label class="field"><span>Email</span><input id="loginEmail" type="email" inputmode="email" autocomplete="email" required placeholder="you@example.com"></label><label class="field"><span>Password</span><input id="loginPassword" type="password" autocomplete="current-password" required placeholder="Password"></label><button class="primary" id="emailLoginBtn" type="submit">Sign in</button><button class="auth-link" id="forgotPasswordBtn" type="button">Forgot password?</button></form></section></main>`);
  document.getElementById("forgotPasswordBtn").onclick=()=>{view.page="forgotPassword";render()};
  document.getElementById("emailLoginForm").onsubmit=async(event)=>{
    event.preventDefault();
    const btn=document.getElementById("emailLoginBtn");
    const email=document.getElementById("loginEmail").value.trim();
    const password=document.getElementById("loginPassword").value;
    btn.disabled=true;btn.textContent="Signing in…";
    try{
      let result;
      try{
        result=await authClient.signIn.email({email,password});
      }catch(err){
        throw new Error(`SIGN-IN REQUEST FAILED: ${err?.message||"Unknown error"}`);
      }
      if(result?.error)throw new Error(`SIGN-IN REJECTED: ${result.error.message||result.error.code||"Email or password was not accepted"}`);
      let session;
      try{
        session=await getAuthSession();
      }catch(err){
        throw new Error(`SESSION CHECK FAILED: ${err?.message||"Unknown error"}`);
      }
      if(!session?.user)throw new Error("SIGN-IN SUCCEEDED, BUT SESSION CHECK RETURNED NO USER.");
      try{
        await testWorkerAuth(session);
      }catch(err){
        throw new Error(`WORKER AUTH TEST FAILED: ${err?.message||"Unknown error"}`);
      }
      history.replaceState({},"",window.location.pathname+window.location.hash);authSession=session;state.currentUser=authDisplayName(session);saveState();view.page="home";render();syncCowsFromNeon();syncMessagesFromNeon({rerender:false});
    }catch(err){console.error("Email sign in failed",err);renderLogin(`DIAGNOSTIC V34: ${err.message||"Could not sign in"}`);}
  };
}
function renderForgotPassword(message="",isError=false){
  usePage(`<main class="screen auth-screen"><section class="auth-card"><p class="eyebrow">Cattle Records</p><h1>Reset password</h1><p class="muted">Enter your account email and we'll send you a password reset link.</p>${message?`<p class="${isError?"auth-error":"auth-success"}">${esc(message)}</p>`:""}<form class="stack" id="forgotPasswordForm"><label class="field"><span>Email</span><input id="resetEmail" type="email" inputmode="email" autocomplete="email" required placeholder="you@example.com"></label><button class="primary" id="sendResetBtn" type="submit">Send reset link</button><button class="auth-link" id="backToLoginBtn" type="button">Back to sign in</button></form></section></main>`);
  document.getElementById("backToLoginBtn").onclick=()=>{view.page="login";render()};
  document.getElementById("forgotPasswordForm").onsubmit=async(event)=>{
    event.preventDefault();
    const btn=document.getElementById("sendResetBtn");
    const email=document.getElementById("resetEmail").value.trim();
    btn.disabled=true;btn.textContent="Sending…";
    try{
      const redirectTo=`${window.location.origin}${window.location.pathname}?reset=1`;
      const result=await authClient.requestPasswordReset({email,redirectTo});
      if(result?.error)throw new Error(result.error.message||"Could not send reset email");
      renderForgotPassword("If that email belongs to an account, a password reset link has been sent. Check your inbox and spam folder.",false);
    }catch(err){console.error("Password reset request failed",err);renderForgotPassword(err.message||"Could not send reset email",true);}
  };
}
function renderResetPassword(token,message="",isError=false){
  if(!token){view.page="login";return renderLogin("This password reset link is missing its reset token.");}
  usePage(`<main class="screen auth-screen"><section class="auth-card"><p class="eyebrow">Cattle Records</p><h1>Choose a new password</h1><p class="muted">Enter your new farm account password.</p>${message?`<p class="${isError?"auth-error":"auth-success"}">${esc(message)}</p>`:""}<form class="stack" id="resetPasswordForm"><label class="field"><span>New password</span><input id="newPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label><label class="field"><span>Confirm password</span><input id="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="Enter it again"></label><button class="primary" id="savePasswordBtn" type="submit">Save new password</button></form></section></main>`);
  document.getElementById("resetPasswordForm").onsubmit=async(event)=>{
    event.preventDefault();
    const password=document.getElementById("newPassword").value;
    const confirm=document.getElementById("confirmPassword").value;
    if(password!==confirm)return renderResetPassword(token,"The two passwords don't match.",true);
    const btn=document.getElementById("savePasswordBtn");btn.disabled=true;btn.textContent="Saving…";
    try{
      const result=await authClient.resetPassword({newPassword:password,token});
      if(result?.error)throw new Error(result.error.message||"Could not reset password");
      history.replaceState({},"",window.location.pathname);
      view.page="login";
      renderLogin("Password changed successfully. Sign in with your new password.");
    }catch(err){console.error("Password reset failed",err);renderResetPassword(token,err.message||"Could not reset password",true);}
  };
}
function renderHome(){const latest=[...state.notes].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))[0]||null,calved=state.cows.filter(c=>latestCurrentYearCalf(c)).length,dead=state.cows.filter(c=>(latestCurrentYearCalf(c)&&latestCurrentYearCalf(c).dead)).length;usePage(`<main class="screen home-screen"><header class="topbar"><div class="home-branding"><div class="app-brand">Cattle Records</div><h1 class="farm-name">${esc(state.farmName||"Cattle Records")}</h1></div><button class="icon-button" id="menuBtn">☰</button></header><section class="home-actions"><button class="home-card" id="openCattle"><div class="home-card-row"><div class="home-card-icon">🐄</div><div class="home-card-copy"><div class="home-card-title">Cattle</div><div class="home-card-sub">${state.cows.length} cows · ${calved} calved this year</div></div><span class="chevron">›</span></div></button><button class="home-card" id="openChat"><div class="home-card-row"><div class="home-card-icon">💬</div><div class="home-card-copy"><div class="home-card-title">Farm Chat</div><div class="home-card-sub">${latest?`${esc(latest.user)}: ${esc(latest.text||"Photo")}`:"No messages yet"}</div></div><div>${latest?`<div class="chat-preview-date">${shortDate(latest.timestamp)}</div>`:""}<span class="chevron">›</span></div></div></button></section><section class="home-summary"><div class="mini-stat"><strong>${state.cows.length}</strong><span>Total cows</span></div><div class="mini-stat"><strong>${calved}</strong><span>Calved ${currentYear()}</span></div><div class="mini-stat"><strong>${dead}</strong><span>Dead calf flags</span></div></section>
<section class="home-ranch-scene" aria-hidden="true"></section>
</main>`);document.getElementById("openCattle").onclick=()=>{view.page="cattle";render();syncCowsFromNeon()};document.getElementById("openChat").onclick=()=>{view.page="chat";render();syncMessagesFromNeon()};document.getElementById("menuBtn").onclick=showFarmMenu}
function activityIcon(type){return type==="cow"?"🐄":type==="calf"?"🐮":type==="owner"?"👤":"•"}
function activityActionLabel(action){return action==="created"?"Added":action==="deleted"?"Deleted":"Updated"}
function renderActivity(){
  const rows=activityEntries.map(item=>`<article class="activity-item activity-${attr(item.action)}">
    <div class="activity-icon" aria-hidden="true">${activityIcon(item.entityType)}</div>
    <div class="activity-copy">
      <div class="activity-description">${esc(item.description)}</div>
      <div class="activity-meta"><span>${esc(activityActionLabel(item.action))} ${esc(item.entityType)}</span><span>·</span><time datetime="${attr(item.createdAt||"")}">${item.createdAt?esc(formatDateTime(item.createdAt)):"Unknown time"}</time></div>
    </div>
  </article>`).join("");
  usePage(`<main class="screen activity-screen">
    <header class="topbar">
      <div class="back-title">
        <button class="icon-button" id="backActivity">←</button>
        <div><p class="eyebrow">${esc(state.farmName||"Farm")}</p><h1 class="page-title">Activity</h1></div>
      </div>
      <button class="soft small" id="refreshActivity" type="button">Refresh</button>
    </header>
    <p class="activity-intro">Cattle record changes made by farm users.</p>
    <section class="activity-list">
      ${!activityLoaded?`<div class="activity-status"><span class="activity-spinner" aria-hidden="true"></span><span>Loading activity…</span></div>`:activityError?`<div class="empty activity-error"><strong>Could not load activity.</strong><br>${esc(activityError)}</div>`:rows||`<div class="empty"><strong>No activity yet.</strong><br>New cattle, calf, and owner changes will appear here.</div>`}
    </section>
  </main>`);
  document.getElementById("backActivity").onclick=()=>{view.page="home";render()};
  document.getElementById("refreshActivity").onclick=async()=>{
    const btn=document.getElementById("refreshActivity");
    btn.disabled=true;btn.textContent="Refreshing…";
    await syncActivityFromNeon();
  };
}

function renderCattle(){
  let cows=sortedCows(state.cows);
  if(view.ownerFilter)cows=cows.filter(c=>c.owner===view.ownerFilter);
  if(view.search){
    const q=view.search.trim().toLowerCase();
    cows=cows.filter(c=>c.brand.toLowerCase().includes(q));
  }

  usePage(`<main class="screen">
    <header class="topbar">
      <div class="back-title">
        <button class="icon-button" id="backHome">←</button>
        <h1 class="page-title">Cattle</h1>
      </div>
      <div class="cattle-header-actions">
        <button class="soft small" id="herdScoreBtn">Scorecard</button>
        <button class="primary small" id="addMenuBtn">+ Add</button>
      </div>
    </header>

    <section class="cattle-tools">
      <div class="search-wrap">
        <span class="search-icon">⌕</span>
        <input id="cowSearch" inputmode="numeric" placeholder="Search brand number" value="${attr(view.search)}">
      </div>
      <button class="soft" id="ownersBtn">Owners</button>
    </section>

    ${view.ownerFilter?`<div class="filter-bar"><span>Owner: ${esc(view.ownerFilter)}</span><button class="link-btn" id="clearOwner">Clear</button></div>`:""}

    <div class="cattle-count">${cows.length} ${cows.length===1?"cow":"cows"}</div>

    <section class="cattle-grid">
      ${cows.length?cows.map(c=>{
        const latest=latestCurrentYearCalf(c);
        return `<button class="cattle-number ${latest&&latest.dead?"dead":""}" data-cow="${c.id}">
          <span class="cattle-brand">${esc(c.brand)}</span>
          <span class="cattle-calving">${latest?`${monthName(latest.month)} ${latest.year}`:"Hasn't calved yet"}</span>
        </button>`;
      }).join(""):`<div class="empty" style="grid-column:1/-1">No cows found.</div>`}
    </section>
  </main>`);

  document.getElementById("backHome").onclick=()=>{view.page="home";render()};
  document.getElementById("addMenuBtn").onclick=showAddMenu;
  document.getElementById("herdScoreBtn").onclick=()=>{view.page="herdScorecard";render()};
  document.getElementById("ownersBtn").onclick=showOwnersModal;

  if(view.ownerFilter){
    document.getElementById("clearOwner").onclick=()=>{view.ownerFilter="";render()};
  }

  document.getElementById("cowSearch").addEventListener("input",e=>{
    view.search=e.target.value;
    renderCattle();
    const i=document.getElementById("cowSearch");
    i.focus();
    i.setSelectionRange(i.value.length,i.value.length);
  });

  document.querySelectorAll("[data-cow]").forEach(b=>b.onclick=()=>{
    view.cowId=b.dataset.cow;
    view.page="cow";
    render();
  });
}
function renderCow(){
  const cow=state.cows.find(c=>c.id===view.cowId);
  if(!cow){view.page="cattle";return render()}
  const calves=sortedCalves(cow);

  usePage(`<main class="cow-page-fixed">
    <header class="cow-fixed-top">
      <button class="icon-button" id="backCattle">←</button>
      <button class="icon-button" id="cowMenuBtn">•••</button>
    </header>

    <section class="cow-head cow-fixed-head">
      <div class="cow-head-row">
        <div>
          <p class="eyebrow">Brand number</p>
          <div class="brand-number">${esc(cow.brand)}</div>
        </div>
      </div>
      <label class="inline-field">
        <span>Owner</span>
        <input id="ownerInput" maxlength="80" placeholder="Optional" value="${attr(cow.owner||"")}">
      </label>
    </section>

    <section class="cow-calves-panel">
      <div class="section-heading cow-calves-heading">
        <div>
          <p class="eyebrow">History</p>
          <h2>Calves</h2>
        </div>
        <button class="primary small" id="addCalfBtn">+ Calf</button>
      </div>

      <div class="cow-calves-scroll">
        ${calves.length?calves.map(c=>{
          const meta=[c.gender,c.color].filter(Boolean).join(" · ");
          return `<button class="calf-card" data-calf="${c.id}">
            <div class="calf-top">
              <span class="calf-date">${fullMonthName(c.month)} ${c.year}</span>
              ${c.dead?`<span class="dead-badge">Died</span>`:""}
            </div>
            <div class="calf-meta">${meta||"No extra information"}</div>
          </button>`;
        }).join(""):`<div class="empty">No calf records yet.</div>`}
      </div>

      <button class="scorecard-link cow-fixed-scorecard" id="scorecardBtn">
        <span>View performance scorecard</span>
        <span>›</span>
      </button>
    </section>
  </main>`);

  document.getElementById("backCattle").onclick=()=>{view.page="cattle";render()};
  document.getElementById("ownerInput").onchange=async e=>{
    const input=e.target,oldOwner=cow.owner||"",oldOwnerId=cow.ownerId||null,newName=input.value.trim();
    input.disabled=true;
    try{
      const owner=await ensureOwnerByName(newName);
      const response=await apiFetch(`/api/cows/${encodeURIComponent(cow.id)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({owner_id:owner?.id||null})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not update owner");
      cow.ownerId=data.cow.owner_id||null;cow.owner=owner?.name||"";cow.updatedAt=data.cow.updated_at||null;saveState();
    }catch(err){cow.owner=oldOwner;cow.ownerId=oldOwnerId;input.value=oldOwner;alert(`Could not update owner in the shared database. ${err.message}`)}
    finally{input.disabled=false}
  };
  document.getElementById("addCalfBtn").onclick=()=>showCalfModal(cow,null);
  document.getElementById("scorecardBtn").onclick=()=>{view.page="scorecard";render()};
  document.getElementById("cowMenuBtn").onclick=()=>showCowMenu(cow);

  document.querySelectorAll("[data-calf]").forEach(b=>{
    const calf=cow.calves.find(c=>c.id===b.dataset.calf);
    b.onclick=()=>showCalfModal(cow,calf);
  });
}
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

    <button class="never-calved-btn" id="neverCalvedBtn">
      <span>
        <strong>${state.cows.filter(c=>!c.calves||c.calves.length===0).length}</strong>
        cows have never calved
      </span>
      <span>View cows ›</span>
    </button>
  </main>`);
  document.getElementById("backCattle").onclick=()=>{view.page="cattle";render()};
  document.getElementById("neverCalvedBtn").onclick=showNeverCalvedModal;
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
let chatSyncInFlight=null;
async function syncMessagesFromNeon({rerender=true}={}){
  if(chatSyncInFlight)return chatSyncInFlight;
  chatSyncInFlight=(async()=>{
    try{
      const response=await apiFetch("/api/messages",{headers:{Accept:"application/json"},cache:"no-store"});
      const data=await response.json();
      if(!response.ok||!data.ok||!Array.isArray(data.messages))throw new Error(data.error||data.message||"Could not load messages");
      state.notes=data.messages.map(m=>({
        id:m.id,
        authUserId:m.auth_user_id||"",
        user:m.display_name||"User",
        timestamp:m.created_at,
        text:m.message_text||"",
        photo:m.photo_url||null,
        shared:true
      }));
      const livePhotoIds=new Set(state.notes.filter(n=>n.photo).map(n=>String(n.id)));
      for(const id of [...chatPhotoUrls.keys()])if(!livePhotoIds.has(id))releaseChatPhotoUrl(id);
      saveState();
      if(rerender&&view.page==="chat")renderChat();
      else if(rerender&&view.page==="home")renderHome();
      return true;
    }catch(err){console.error("Could not sync Farm Chat from Neon",err);return false}
    finally{chatSyncInFlight=null}
  })();
  return chatSyncInFlight;
}

function renderChat(){
  const notes=[...state.notes].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  const media=notes.filter(n=>n.photo);
  usePage(`<main class="screen chat-screen">
    <header class="topbar chat-header">
      <div class="back-title">
        <button class="icon-button" id="backHome">←</button>
        <div>
          <p class="eyebrow">${esc(state.farmName||"Farm")}</p>
          <h1 class="page-title">Farm Chat</h1>
        </div>
      </div>
      <button class="soft chat-media-btn" id="openMedia" type="button">Media${media.length?` (${media.length})`:""}</button>
    </header>

    <section class="chat-list" id="chatList">
      ${notes.length?notes.map(n=>`<div class="message-row ${n.user===state.currentUser?"me":""}">
        <article class="message-bubble">
          <div class="message-topline"><div class="message-meta">${esc(n.user)} · ${formatDateTime(n.timestamp)}</div><button class="message-menu-btn" type="button" data-message-menu="${attr(n.id)}" aria-label="Message options">•••</button></div>
          ${n.text?`<div class="message-text">${esc(n.text)}</div>`:""}
          ${n.photo?`<button class="chat-photo-button" type="button" data-chat-photo-id="${attr(n.id)}" data-photo-shell><div class="chat-photo-loading">Loading photo…</div><img data-chat-media-id="${attr(n.id)}" alt="Farm chat photo" hidden></button>`:""}
        </article>
      </div>`).join(""):`<div class="empty">No messages yet.</div>`}
    </section>

    <section class="chat-composer">
      <form id="chatForm" class="chat-compose-box">
        <textarea id="chatText" rows="2" maxlength="500" placeholder="Message or photo caption"></textarea>
        <div class="chat-photo-preview" id="chatPhotoPreview" hidden></div>
        <div class="composer-row">
          <label class="photo-button" id="chatPhotoLabel"><span>📷 Photo</span><input id="chatPhotoInput" type="file" accept="image/*"></label>
          <button class="primary small" id="chatSendBtn" type="submit">Send</button>
        </div>
      </form>
    </section>
  </main>`);
  document.getElementById("backHome").onclick=()=>{pendingPhoto=null;view.page="home";render()};
  document.getElementById("openMedia").onclick=()=>showChatMedia(notes);
  setupChatComposer();
  hydrateChatPhotos(document);
  document.querySelectorAll("[data-chat-photo-id]").forEach(btn=>{btn.onclick=()=>{const n=state.notes.find(x=>String(x.id)===String(btn.dataset.chatPhotoId));if(n)openPhotoViewer(n)}});
  document.querySelectorAll("[data-message-menu]").forEach(btn=>{btn.onclick=()=>showMessageMenu(btn.dataset.messageMenu)});
  const list=document.getElementById("chatList");
  if(list)list.scrollTop=list.scrollHeight;
}

function showMessageMenu(messageId){
  const message=state.notes.find(n=>String(n.id)===String(messageId));
  if(!message)return;
  openModal(`<div class="modal-card"><div class="section-heading"><div><p class="eyebrow">Farm Chat</p><h2>Message options</h2></div><button class="icon-button" id="closeMessageMenu">×</button></div><button class="danger message-delete-action" id="deleteChatMessage">Delete message</button></div>`,()=>{
    document.getElementById("closeMessageMenu").onclick=closeModal;
    document.getElementById("deleteChatMessage").onclick=async()=>{
      if(!confirm("Delete this message for everyone?"))return;
      const btn=document.getElementById("deleteChatMessage");btn.disabled=true;btn.textContent="Deleting…";
      try{
        const response=await apiFetch(`/api/messages/${encodeURIComponent(messageId)}`,{method:"DELETE"});
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not delete message");
        releaseChatPhotoUrl(messageId);
        state.notes=state.notes.filter(n=>String(n.id)!==String(messageId));saveState();closeModal();renderChat();
      }catch(err){alert(`Could not delete message. ${err.message}`);btn.disabled=false;btn.textContent="Delete message"}
    };
  });
}

function showChatMedia(notes=state.notes){
  const media=[...notes].filter(n=>n.photo).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  openModal(`<div class="modal-card media-modal"><div class="section-heading"><div><p class="eyebrow">Farm Chat</p><h2>Media</h2></div><button class="icon-button" id="closeMedia">×</button></div>${media.length?`<div class="media-grid">${media.map(n=>`<button type="button" class="media-thumb" data-media-message-id="${attr(n.id)}"><div class="media-thumb-photo" data-photo-shell><div class="chat-photo-loading">Loading…</div><img data-chat-media-id="${attr(n.id)}" alt="Photo sent by ${attr(n.user)}" hidden></div><span>${esc(n.user)} · ${shortDate(n.timestamp)}</span></button>`).join("")}</div>`:`<div class="empty media-empty"><strong>No shared photos yet.</strong><br>Photos sent in Farm Chat will appear here.</div>`}</div>`,()=>{
    document.getElementById("closeMedia").onclick=closeModal;
    hydrateChatPhotos(modalRoot);
    modalRoot.querySelectorAll("[data-media-message-id]").forEach(btn=>btn.onclick=()=>{const n=state.notes.find(x=>String(x.id)===String(btn.dataset.mediaMessageId));if(n)openPhotoViewer(n)});
  });
}

function openPhotoViewer(message){
  if(!message?.id)return;
  const viewer=document.createElement("div");
  viewer.className="photo-viewer";
  viewer.innerHTML=`
    <button type="button" class="photo-viewer-close" aria-label="Close">×</button>
    <div class="photo-viewer-stage">
      <div class="photo-viewer-loading">Loading photo…</div>
      <img class="photo-viewer-image" alt="Photo posted by ${attr(message.user||"User")}" hidden>
    </div>
    <div class="photo-viewer-info"><strong>${esc(message.user||"User")}</strong><span>${formatDateTime(message.timestamp)}</span></div>
  `;
  document.body.appendChild(viewer);

  const stage=viewer.querySelector(".photo-viewer-stage");
  const img=viewer.querySelector(".photo-viewer-image");
  const loading=viewer.querySelector(".photo-viewer-loading");
  const close=()=>viewer.remove();

  getChatPhotoUrl(message.id).then(url=>{
    if(!viewer.isConnected)return;
    img.src=url;img.hidden=false;loading.hidden=true;
  }).catch(err=>{if(viewer.isConnected)loading.textContent=err.message||"Could not load photo"});

  viewer.querySelector(".photo-viewer-close").onclick=close;
  viewer.addEventListener("click",e=>{
    if(e.target===viewer||e.target===stage)close();
  });

  let scale=1,startDist=0,startScale=1;
  let x=0,y=0,startX=0,startY=0,dragging=false;
  let lastTap=0;

  const apply=()=>{
    img.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
  };

  const clampScale=v=>Math.max(1,Math.min(4,v));

  const distance=touches=>{
    const [a,b]=touches;
    return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  };

  stage.addEventListener("touchstart",e=>{
    if(e.touches.length===2){
      startDist=distance(e.touches);
      startScale=scale;
      dragging=false;
    }else if(e.touches.length===1 && scale>1){
      dragging=true;
      startX=e.touches[0].clientX-x;
      startY=e.touches[0].clientY-y;
    }
  },{passive:false});

  stage.addEventListener("touchmove",e=>{
    if(e.touches.length===2){
      e.preventDefault();
      const d=distance(e.touches);
      scale=clampScale(startScale*(d/startDist));
      if(scale===1){x=0;y=0}
      apply();
    }else if(e.touches.length===1 && dragging && scale>1){
      e.preventDefault();
      x=e.touches[0].clientX-startX;
      y=e.touches[0].clientY-startY;
      apply();
    }
  },{passive:false});

  stage.addEventListener("touchend",e=>{
    if(e.touches.length===0)dragging=false;
  });

  stage.addEventListener("dblclick",()=>{
    if(scale>1){scale=1;x=0;y=0}
    else scale=2;
    apply();
  });

  img.addEventListener("click",e=>{
    const now=Date.now();
    if(now-lastTap<300){
      if(scale>1){scale=1;x=0;y=0}
      else scale=2;
      apply();
    }
    lastTap=now;
    e.stopPropagation();
  });
}

function setupChatComposer(){
  const form=document.getElementById("chatForm"),input=document.getElementById("chatText"),btn=document.getElementById("chatSendBtn"),photoInput=document.getElementById("chatPhotoInput"),photoLabel=document.getElementById("chatPhotoLabel"),preview=document.getElementById("chatPhotoPreview");
  let previewUrl=null;
  const clearPreview=()=>{
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}
    pendingPhoto=null;
    photoInput.value="";
    preview.hidden=true;preview.innerHTML="";
    photoLabel.classList.remove("is-preparing");
    photoLabel.querySelector("span").textContent="📷 Photo";
  };
  photoInput.onchange=async()=>{
    const chosen=photoInput.files?.[0];
    if(!chosen){clearPreview();return}
    photoLabel.classList.add("is-preparing");photoLabel.querySelector("span").textContent="Preparing…";btn.disabled=true;
    try{
      const prepared=await prepareChatPhoto(chosen);
      pendingPhoto=prepared;
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=URL.createObjectURL(prepared);
      preview.innerHTML=`<div class="chat-photo-preview-card"><img src="${attr(previewUrl)}" alt="Photo ready to send"><div><strong>Photo ready</strong><span>${Math.max(1,Math.round(prepared.size/1024))} KB</span></div><button type="button" class="icon-button chat-photo-remove" aria-label="Remove photo">×</button></div>`;
      preview.hidden=false;
      preview.querySelector(".chat-photo-remove").onclick=clearPreview;
    }catch(err){
      clearPreview();
      alert(err.message||"Could not prepare that photo.");
    }finally{
      photoLabel.classList.remove("is-preparing");photoLabel.querySelector("span").textContent="📷 Photo";btn.disabled=false;
    }
  };
  form.onsubmit=async e=>{
    e.preventDefault();
    const text=input.value.trim();
    if(!text&&!pendingPhoto)return;
    btn.disabled=true;btn.textContent=pendingPhoto?"Uploading…":"Sending…";photoInput.disabled=true;
    try{
      let response;
      if(pendingPhoto){
        const formData=new FormData();
        formData.append("photo",pendingPhoto,pendingPhoto.name||`farm-photo-${Date.now()}.jpg`);
        if(text)formData.append("message_text",text);
        response=await apiFetch("/api/messages/photo",{method:"POST",body:formData});
      }else{
        response=await apiFetch("/api/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message_text:text})});
      }
      const data=await response.json();
      if(!response.ok||!data.ok||!data.message)throw new Error(data.error||data.message||"Could not send message");
      const m=data.message;
      state.notes.push({id:m.id,authUserId:m.auth_user_id||"",user:m.display_name||state.currentUser||"User",timestamp:m.created_at,text:m.message_text||"",photo:m.photo_url||null,shared:true});
      if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}
      pendingPhoto=null;saveState();renderChat();
    }catch(err){alert(`Could not send message. ${err.message}`);btn.disabled=false;btn.textContent="Send";photoInput.disabled=false}
  };
}

function openModal(html,onReady){modalRoot.innerHTML=`<div class="modal-backdrop"><section class="modal">${html}</section></div>`;const b=modalRoot.querySelector(".modal-backdrop");b.onclick=e=>{if(e.target===b)closeModal()};onReady?.()}
function closeModal(){modalRoot.innerHTML=""}
function showOwnersModal(){const owners=state.owners.map(o=>o.name).filter(Boolean).sort((a,b)=>a.localeCompare(b));openModal(`<div class="modal-card"><div class="section-heading"><div><p class="eyebrow">Filter cattle</p><h2>Owners</h2></div><button class="icon-button" id="closeModal">×</button></div><div class="owner-list">${owners.length?owners.map(o=>`<button class="owner-choice" data-owner="${attr(o)}">${esc(o)}</button>`).join(""):`<div class="empty">No owners yet.</div>`}</div></div>`,()=>{document.getElementById("closeModal").onclick=closeModal;modalRoot.querySelectorAll("[data-owner]").forEach(b=>b.onclick=()=>{view.ownerFilter=b.dataset.owner;closeModal();render()})})}


function showAddMenu(){
  openModal(`<section class="modal-card add-menu-modal">
    <p class="eyebrow">Add to herd</p>
    <h2>What would you like to add?</h2>

    <div class="add-choice-grid">
      <button type="button" class="add-choice" id="chooseAddCow">
        <span class="add-choice-icon">＋</span>
        <span>
          <strong>Add cow</strong>
          <small>Add one cow to the herd</small>
        </span>
      </button>

      <button type="button" class="add-choice" id="chooseAddCalves">
        <span class="add-choice-icon">＋</span>
        <span>
          <strong>Add calves</strong>
          <small>Add calves to several cows at once</small>
        </span>
      </button>
    </div>

    <div class="modal-actions">
      <button type="button" class="soft" id="closeAddMenu">Cancel</button>
    </div>
  </section>`,()=>{
    document.getElementById("closeAddMenu").onclick=closeModal;
    document.getElementById("chooseAddCow").onclick=()=>{
      closeModal();
      showAddCowModal();
    };
    document.getElementById("chooseAddCalves").onclick=()=>{
      closeModal();
      showBatchCalvesModal();
    };
  });
}

function showBatchCalvesModal(){
  const now=new Date();
  const batch={
    month:now.getMonth()+1,
    year:currentYear(),
    brands:[],
    details:{}
  };

  const parseBrands=text=>{
    const raw=text.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
    return [...new Set(raw)];
  };

  const getCowByBrand=brand=>state.cows.find(c=>String(c.brand).trim()===String(brand).trim());

  const renderRows=brands=>{
    const valid=brands.map(brand=>({brand,cow:getCowByBrand(brand)}));
    const wrap=document.getElementById("batchCowRows");
    if(!wrap)return;

    wrap.innerHTML=valid.length?valid.map(({brand,cow})=>{
      if(!cow){
        return `<div class="batch-cow-row invalid">
          <div class="batch-cow-main">
            <strong>${esc(brand)}</strong>
            <span>Not found</span>
          </div>
        </div>`;
      }

      const d=batch.details[cow.id]||{gender:"",color:"",dead:false,notes:"",open:false};
      batch.details[cow.id]=d;

      return `<div class="batch-cow-row" data-batch-cow="${cow.id}">
        <div class="batch-cow-main">
          <div>
            <strong>Cow ${esc(cow.brand)}</strong>
            <span>${esc(cow.owner||"No owner")}</span>
          </div>
          <button type="button" class="link-btn batch-info-toggle" data-toggle="${cow.id}">
            ${d.open?"Hide information":"Add information"}
          </button>
        </div>

        <div class="batch-cow-details ${d.open?"":"hidden"}" data-details="${cow.id}">
          <label>
            <span>Gender</span>
            <select data-field="gender" data-id="${cow.id}">
              <option value="">Optional</option>
              <option value="Heifer" ${d.gender==="Heifer"?"selected":""}>Heifer</option>
              <option value="Bull" ${d.gender==="Bull"?"selected":""}>Bull</option>
            </select>
          </label>

          <label>
            <span>Color</span>
            <input data-field="color" data-id="${cow.id}" maxlength="60" value="${attr(d.color||"")}" placeholder="Optional">
          </label>

          <label class="checkbox-row">
            <input type="checkbox" data-field="dead" data-id="${cow.id}" ${d.dead?"checked":""}>
            <span>Dead calf</span>
          </label>

          <label>
            <span>Notes</span>
            <textarea data-field="notes" data-id="${cow.id}" rows="3" maxlength="1000" placeholder="Optional">${esc(d.notes||"")}</textarea>
          </label>
        </div>
      </div>`;
    }).join(""):`<div class="empty">Enter cow brand numbers above.</div>`;

    wrap.querySelectorAll("[data-toggle]").forEach(btn=>{
      btn.onclick=()=>{
        const id=btn.dataset.toggle;
        batch.details[id].open=!batch.details[id].open;
        renderRows(batch.brands);
      };
    });

    wrap.querySelectorAll("[data-field]").forEach(el=>{
      const id=el.dataset.id;
      const field=el.dataset.field;
      const save=()=>{
        batch.details[id][field]=field==="dead"?el.checked:el.value;
      };
      el.addEventListener(field==="dead"?"change":"input",save);
      if(el.tagName==="SELECT")el.addEventListener("change",save);
    });
  };

  openModal(`<form class="modal-card batch-calves-modal" id="batchCalvesForm">
    <p class="eyebrow">Batch entry</p>
    <h2>Add calves</h2>
    <p class="muted">Use one birth date for all of these calves, then optionally add details for each cow.</p>

    <div class="batch-date-row">
      <label>
        <span>Month</span>
        <select id="batchMonth">
          ${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}" ${m===batch.month?"selected":""}>${fullMonthName(m)}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>Year</span>
        <input id="batchYear" type="number" min="1900" max="2200" value="${batch.year}" required>
      </label>
    </div>

    <label>
      <span>Cow brand numbers</span>
      <textarea id="batchBrands" rows="4" placeholder="Example: 12, 32, 55, 96"></textarea>
      <small class="field-help">Separate numbers with spaces, commas, or new lines.</small>
    </label>

    <div class="batch-cow-list" id="batchCowRows">
      <div class="empty">Enter cow brand numbers above.</div>
    </div>

    <div class="modal-actions batch-actions">
      <button type="button" class="soft" id="cancelBatchCalves">Cancel</button>
      <button type="submit" class="primary" id="saveBatchCalves">Save calves</button>
    </div>
  </form>`,()=>{
    const brandsInput=document.getElementById("batchBrands");
    const monthInput=document.getElementById("batchMonth");
    const yearInput=document.getElementById("batchYear");

    document.getElementById("cancelBatchCalves").onclick=closeModal;

    const syncBrands=()=>{
      batch.brands=parseBrands(brandsInput.value);
      renderRows(batch.brands);
    };
    brandsInput.addEventListener("input",syncBrands);

    monthInput.addEventListener("change",()=>batch.month=Number(monthInput.value));
    yearInput.addEventListener("input",()=>batch.year=Number(yearInput.value));

    document.getElementById("batchCalvesForm").onsubmit=async e=>{
      e.preventDefault();
      batch.month=Number(monthInput.value);
      batch.year=Number(yearInput.value);
      batch.brands=parseBrands(brandsInput.value);

      const cows=batch.brands.map(getCowByBrand).filter(Boolean);
      const unknown=batch.brands.filter(b=>!getCowByBrand(b));

      if(!batch.brands.length){
        alert("Enter at least one cow brand number.");
        return;
      }
      if(unknown.length){
        alert("These cow numbers were not found: "+unknown.join(", "));
        return;
      }
      if(!cows.length)return;

      const saveBtn=document.getElementById("saveBatchCalves");
      saveBtn.disabled=true;
      saveBtn.textContent=`Saving 0/${cows.length}…`;

      let saved=0;
      try{
        for(const cow of cows){
          const d=batch.details[cow.id]||{};
          const response=await apiFetch("/api/calves",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              cow_id:cow.id,
              birth_month:batch.month,
              birth_year:batch.year,
              gender:d.gender||null,
              color:(d.color||"").trim()||null,
              is_dead:!!d.dead,
              notes:(d.notes||"").trim()||null
            })
          });
          const data=await response.json().catch(()=>({}));
          if(!response.ok||!data.ok){
            throw new Error(`Cow ${cow.brand}: ${data.error||data.message||`HTTP ${response.status}`}`);
          }
          saved++;
          saveBtn.textContent=`Saving ${saved}/${cows.length}…`;
        }

        await syncCowsFromNeon({rerender:false});
        closeModal();
        render();
      }catch(err){
        console.error("Could not save batch calves",err);
        await syncCowsFromNeon({rerender:false});
        alert(saved
          ? `${saved} of ${cows.length} calves were saved before an error occurred. The saved records are already in the shared database. ${err.message}`
          : `Could not save calves to the shared database. ${err.message}`);
        closeModal();
        render();
      }
    };

    renderRows([]);
  });
}
function showAddCowModal(){openModal(`<form class="modal-card" id="addCowForm"><p class="eyebrow">New cow</p><h2>Add brand number</h2><div class="stack"><label><span>Brand number</span><input id="newBrand" required maxlength="30" inputmode="numeric"></label><label><span>Owner</span><input id="newOwner" maxlength="80" placeholder="Optional"></label></div><div class="modal-actions"><button type="button" class="soft" id="cancelCow">Cancel</button><button type="submit" class="primary" id="saveCowBtn">Add cow</button></div></form>`,()=>{document.getElementById("cancelCow").onclick=closeModal;document.getElementById("addCowForm").onsubmit=async e=>{e.preventDefault();const brand=document.getElementById("newBrand").value.trim(),ownerName=document.getElementById("newOwner").value.trim(),btn=document.getElementById("saveCowBtn");if(!brand)return;if(state.cows.some(c=>c.brand.toLowerCase()===brand.toLowerCase())){alert("That brand number already exists.");return}btn.disabled=true;btn.textContent="Saving…";try{const owner=await ensureOwnerByName(ownerName);const response=await apiFetch("/api/cows",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({brand_number:brand,owner_id:owner?.id||null,created_by:state.currentUser||null})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not save cow");state.cows.push({id:data.cow.id,brand:data.cow.brand_number,ownerId:data.cow.owner_id||null,owner:owner?.name||"",calves:[]});saveState();closeModal();render()}catch(err){alert(`Could not save cow to the shared database. ${err.message}`);btn.disabled=false;btn.textContent="Add cow"}}})}
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

    if(editing) document.getElementById("deleteCalf").onclick=async()=>{
      if(!confirm("Delete this calf record?")) return;
      const btn=document.getElementById("deleteCalf");
      btn.disabled=true;
      btn.textContent="Deleting…";
      try{
        const response=await apiFetch(`/api/calves/${encodeURIComponent(calf.id)}`,{method:"DELETE"});
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not delete calf");
        cow.calves=cow.calves.filter(c=>c.id!==calf.id);
        saveState();
        closeModal();
        render();
      }catch(err){
        alert(`Could not delete calf from the shared database. ${err.message}`);
        btn.disabled=false;
        btn.textContent="Delete";
      }
    };

    document.getElementById("calfForm").onsubmit=async e=>{
      e.preventDefault();
      const form=e.currentTarget;
      const submitBtn=form.querySelector('button[type="submit"]');
      const record={
        id:editing?calf.id:uid(),
        month:Number(document.getElementById("calfMonth").value),
        year:Number(document.getElementById("calfYear").value),
        gender:document.getElementById("calfGender").value,
        color:document.getElementById("calfColor").value.trim(),
        dead:document.getElementById("calfDead").checked,
        notes:document.getElementById("calfNotes").value.trim()
      };

      if(editing){
        submitBtn.disabled=true;
        submitBtn.textContent="Saving…";
        try{
          const response=await apiFetch(`/api/calves/${encodeURIComponent(calf.id)}`,{
            method:"PUT",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              birth_month:record.month,
              birth_year:record.year,
              gender:record.gender||null,
              color:record.color||null,
              is_dead:record.dead,
              notes:record.notes||null
            })
          });
          const data=await response.json();
          if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not update calf");
          Object.assign(calf,{
            id:data.calf.id,
            month:Number(data.calf.birth_month),
            year:Number(data.calf.birth_year),
            gender:appGender(data.calf.gender),
            color:data.calf.color||"",
            dead:Boolean(data.calf.is_dead),
            notes:data.calf.notes||"",
            createdBy:data.calf.created_by||calf.createdBy||"",
            createdAt:data.calf.created_at||calf.createdAt||null,
            updatedAt:data.calf.updated_at||null
          });
          saveState();
          closeModal();
          render();
        }catch(err){
          alert(`Could not update calf in the shared database. ${err.message}`);
          submitBtn.disabled=false;
          submitBtn.textContent="Save";
        }
        return;
      }

      submitBtn.disabled=true;
      submitBtn.textContent="Saving…";
      try{
        const response=await apiFetch("/api/calves",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            cow_id:cow.id,
            birth_month:record.month,
            birth_year:record.year,
            gender:record.gender||null,
            color:record.color||null,
            is_dead:record.dead,
            notes:record.notes||null,
            created_by:state.currentUser||null
          })
        });
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not save calf");
        cow.calves.push({
          id:data.calf.id,
          month:Number(data.calf.birth_month),
          year:Number(data.calf.birth_year),
          gender:appGender(data.calf.gender),
          color:data.calf.color||"",
          dead:Boolean(data.calf.is_dead),
          notes:data.calf.notes||"",
          createdBy:data.calf.created_by||"",
          createdAt:data.calf.created_at||null,
          updatedAt:data.calf.updated_at||null
        });
        saveState();
        closeModal();
        render();
      }catch(err){
        alert(`Could not save calf to the shared database. ${err.message}`);
        submitBtn.disabled=false;
        submitBtn.textContent="Add calf";
      }
    };
  });
}

function showNeverCalvedModal(){
  const cows=sortedCows(state.cows.filter(c=>!c.calves||c.calves.length===0));
  openModal(`<section class="modal-card never-calved-modal">
    <p class="eyebrow">Herd Scorecard</p>
    <h2>Never calved</h2>
    <p class="muted">${cows.length} ${cows.length===1?"cow has":"cows have"} no calf records yet.</p>

    <div class="never-calved-grid">
      ${cows.length?cows.map(c=>`
        <button class="never-calved-cow" data-never-cow="${c.id}">
          ${esc(c.brand)}
        </button>`).join(""):`<div class="empty" style="grid-column:1/-1">Every cow has at least one calf record.</div>`}
    </div>

    <div class="modal-actions">
      <button type="button" class="soft" id="closeNeverCalved">Close</button>
    </div>
  </section>`,()=>{
    document.getElementById("closeNeverCalved").onclick=closeModal;
    document.querySelectorAll("[data-never-cow]").forEach(b=>b.onclick=()=>{
      view.cowId=b.dataset.neverCow;
      view.page="cow";
      closeModal();
      render();
    });
  });
}
async function installPwa(){
  if(isStandalone()){alert("Cattle Records is already installed on this device.");return;}
  if(deferredInstallPrompt){
    const prompt=deferredInstallPrompt;
    deferredInstallPrompt=null;
    await prompt.prompt();
    await prompt.userChoice.catch(()=>null);
    return;
  }
  const android=/Android/i.test(navigator.userAgent);
  const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  if(android){
    alert('To install Cattle Records, open your browser menu (⋮) and choose "Add to Home screen" or "Install app".');
  }else if(ios){
    alert('To install Cattle Records, tap Share and then "Add to Home Screen".');
  }else{
    alert("Use your browser's \"Install app\" or \"Add to Home screen\" option.");
  }
}
function registerServiceWorker(){
  if(!("serviceWorker" in navigator))return;
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./service-worker.js?v=44",{updateViaCache:"none"}).then(reg=>reg.update().catch(()=>null)).catch(err=>console.error("Service worker registration failed",err));
  });
}
registerServiceWorker();
function showFarmMenu(){openModal(`<div class="modal-card"><div class="section-heading"><div><p class="eyebrow">Account</p><h2>${esc(state.currentUser)}</h2></div><button class="icon-button" id="closeMenu">×</button></div><div class="menu-list"><button class="soft" id="activityLog">Activity</button><button class="soft" id="farmProfile">Farm profile</button>${!isStandalone()?'<button class="soft" id="installApp">Install app</button>':''}<button class="soft" id="logout">Log out</button></div></div>`,()=>{document.getElementById("closeMenu").onclick=closeModal;document.getElementById("activityLog").onclick=()=>{closeModal();view.page="activity";activityLoaded=false;activityError="";render();syncActivityFromNeon()};document.getElementById("farmProfile").onclick=showFarmProfile;const installBtn=document.getElementById("installApp");if(installBtn)installBtn.onclick=async()=>{closeModal();await installPwa()};document.getElementById("logout").onclick=async()=>{const btn=document.getElementById("logout");btn.disabled=true;btn.textContent="Logging out…";try{await authClient.signOut()}catch(err){console.error("Neon Auth sign out failed",err)}authSession=null;state.currentUser="";saveState();closeModal();view.page="login";render()}})}

function showFarmProfile(){openModal(`<form class="modal-card" id="farmProfileForm"><p class="eyebrow">Settings</p><h2>Farm profile</h2><div class="stack"><label><span>Farm name</span><input id="farmNameInput" maxlength="100" value="${attr(state.farmName||"")}"></label></div><div class="modal-actions"><button type="button" class="soft" id="cancelFarm">Cancel</button><button type="submit" class="primary">Save</button></div></form>`,()=>{document.getElementById("cancelFarm").onclick=closeModal;document.getElementById("farmProfileForm").onsubmit=e=>{e.preventDefault();state.farmName=document.getElementById("farmNameInput").value.trim()||"Cattle Records";saveState();closeModal();render()}})}
function showCowMenu(cow){openModal(`<div class="modal-card"><p class="eyebrow">Cow ${esc(cow.brand)}</p><h2>Options</h2><div class="menu-list" style="margin-top:14px"><button class="soft" id="editCow">Edit brand number</button><button class="danger" id="deleteCow">Delete cow</button><button class="soft" id="closeCowMenu">Cancel</button></div></div>`,()=>{
  document.getElementById("closeCowMenu").onclick=closeModal;
  document.getElementById("editCow").onclick=()=>showEditCowModal(cow);
  document.getElementById("deleteCow").onclick=async()=>{
    if(!confirm(`Delete cow ${cow.brand} and all calf records?`))return;
    const btn=document.getElementById("deleteCow");
    btn.disabled=true;
    btn.textContent="Deleting…";
    try{
      const response=await apiFetch(`/api/cows/${encodeURIComponent(cow.id)}`,{method:"DELETE"});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not delete cow");
      state.cows=state.cows.filter(c=>c.id!==cow.id);
      saveState();
      closeModal();
      view.page="cattle";
      render();
    }catch(err){
      alert(`Could not delete cow from the shared database. ${err.message}`);
      btn.disabled=false;
      btn.textContent="Delete cow";
    }
  };
})}
function showEditCowModal(cow){openModal(`<form class="modal-card" id="editCowForm"><p class="eyebrow">Cow ${esc(cow.brand)}</p><h2>Edit cow</h2><div class="stack"><label><span>Brand number</span><input id="editBrand" required maxlength="30" inputmode="numeric" value="${attr(cow.brand)}"></label><label><span>Owner</span><input id="editOwner" maxlength="80" placeholder="Optional" value="${attr(cow.owner||"")}"></label></div><div class="modal-actions"><button type="button" class="soft" id="cancelEditCow">Cancel</button><button type="submit" class="primary" id="saveEditCow">Save</button></div></form>`,()=>{
  document.getElementById("cancelEditCow").onclick=closeModal;
  document.getElementById("editCowForm").onsubmit=async e=>{
    e.preventDefault();
    const brand=document.getElementById("editBrand").value.trim();
    const ownerName=document.getElementById("editOwner").value.trim();
    const btn=document.getElementById("saveEditCow");
    if(!brand)return;
    if(state.cows.some(c=>c.id!==cow.id&&c.brand.toLowerCase()===brand.toLowerCase())){alert("That brand number already exists.");return}
    btn.disabled=true;btn.textContent="Saving…";
    try{
      const owner=await ensureOwnerByName(ownerName);
      const response=await apiFetch(`/api/cows/${encodeURIComponent(cow.id)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({brand_number:brand,owner_id:owner?.id||null})});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||data.message||"Could not update cow");
      cow.brand=String(data.cow.brand_number);cow.ownerId=data.cow.owner_id||null;cow.owner=owner?.name||"";cow.updatedAt=data.cow.updated_at||null;
      saveState();closeModal();render();
    }catch(err){alert(`Could not update cow in the shared database. ${err.message}`);btn.disabled=false;btn.textContent="Save"}
  };
})}
try{bootstrapAuth()}catch(err){
  console.error(err);
  const a=document.getElementById("app");
  if(a)a.innerHTML='<main class="screen"><section class="auth-card"><p class="eyebrow">Cattle Records</p><h2>App could not start</h2><p class="muted">Please refresh the page. If this message remains, send a screenshot.</p></section></main>';
}
