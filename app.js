const STORAGE_KEY = "cattleRecordsPrototypeV1";

const initialData = {
  farmName: "Green Valley Farm",
  currentUser: "",
  cows: [
    {
      id: crypto.randomUUID(),
      brand: "247",
      owner: "John",
      calves: [
        { id: crypto.randomUUID(), month: 4, year: 2024, gender: "Heifer", color: "Red", dead: false },
        { id: crypto.randomUUID(), month: 4, year: 2025, gender: "Bull", color: "Red", dead: false },
        { id: crypto.randomUUID(), month: 5, year: 2026, gender: "Heifer", color: "Red", dead: false }
      ]
    },
    {
      id: crypto.randomUUID(),
      brand: "381",
      owner: "Lamar",
      calves: [
        { id: crypto.randomUUID(), month: 3, year: 2025, gender: "Bull", color: "Black", dead: false },
        { id: crypto.randomUUID(), month: 6, year: 2026, gender: "Heifer", color: "Black", dead: true }
      ]
    },
    {
      id: crypto.randomUUID(),
      brand: "412",
      owner: "",
      calves: [
        { id: crypto.randomUUID(), month: 8, year: 2025, gender: "", color: "", dead: false }
      ]
    }
  ],
  notes: [
    {
      id: crypto.randomUUID(),
      user: "John",
      timestamp: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
      text: "Cow 247 is in the north pasture.",
      photo: null
    }
  ]
};

let state = loadState();
let view = { page: state.currentUser ? "home" : "login", cowId: null, ownerFilter: "" };
let pendingPhoto = null;

const app = document.getElementById("app");
const modalRoot = document.getElementById("modalRoot");

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return structuredClone(initialData);
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function currentYear() {
  return new Date().getFullYear();
}
function monthName(m) {
  return new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, m - 1, 1)));
}
function fullMonthName(m) {
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, m - 1, 1)));
}
function cowLatestCurrentYearCalf(cow) {
  const calves = cow.calves
    .filter(c => Number(c.year) === currentYear())
    .sort((a,b) => b.month - a.month);
  return calves[0] || null;
}
function sortedCalves(cow) {
  return [...cow.calves].sort((a,b) => (b.year - a.year) || (b.month - a.month));
}
function monthsApart(a,b) {
  return (b.year - a.year) * 12 + (b.month - a.month);
}
function statsFor(cow) {
  const calvesAsc = [...cow.calves].sort((a,b) => (a.year-b.year) || (a.month-b.month));
  const total = calvesAsc.length;
  const dead = calvesAsc.filter(c => c.dead).length;
  const live = total - dead;

  let avgInterval = null;
  if (total >= 2) {
    const intervals = [];
    for (let i=1; i<calvesAsc.length; i++) intervals.push(monthsApart(calvesAsc[i-1], calvesAsc[i]));
    avgInterval = intervals.reduce((s,n)=>s+n,0) / intervals.length;
  }

  let calvingRate = null;
  if (total) {
    const firstYear = calvesAsc[0].year;
    const yearsExpected = Math.max(1, currentYear() - firstYear + 1);
    const uniqueYears = new Set(calvesAsc.map(c=>c.year)).size;
    calvingRate = uniqueYears / yearsExpected * 100;
  }

  const survival = total ? live / total * 100 : null;
  const deadRate = total ? dead / total * 100 : null;

  let score = null;
  if (total) {
    const intervalScore = avgInterval == null ? 100 : Math.max(0, Math.min(100, 100 - Math.max(0, avgInterval - 12) * 7));
    score = Math.round((calvingRate * .4) + (survival * .4) + (intervalScore * .2));
  }

  return { total, dead, live, avgInterval, calvingRate, survival, deadRate, score };
}
function formatPct(n) {
  return n == null ? "—" : `${Math.round(n)}%`;
}
function formatInterval(n) {
  return n == null ? "—" : `${n.toFixed(1)} mo`;
}
function render() {
  modalRoot.innerHTML = "";
  if (view.page === "login") return renderLogin();
  if (view.page === "cow") return renderCow();
  return renderHome();
}
function useTemplate(id) {
  app.innerHTML = "";
  app.append(document.getElementById(id).content.cloneNode(true));
}
function renderLogin() {
  useTemplate("login-template");
  document.getElementById("loginForm").addEventListener("submit", e => {
    e.preventDefault();
    const username = document.getElementById("usernameInput").value.trim();
    if (!username) return;
    state.currentUser = username;
    saveState();
    view.page = "home";
    render();
  });
}
function renderHome() {
  useTemplate("home-template");
  document.getElementById("farmName").textContent = state.farmName || "Cattle Records";

  const cows = [...state.cows]
    .filter(c => !view.ownerFilter || c.owner === view.ownerFilter)
    .sort((a,b) => a.brand.localeCompare(b.brand, undefined, { numeric: true }));

  const list = document.getElementById("cowList");
  if (!cows.length) {
    list.innerHTML = `<div class="empty">No cows found.</div>`;
  } else {
    cows.forEach(cow => {
      const latest = cowLatestCurrentYearCalf(cow);
      const btn = document.createElement("button");
      btn.className = "cow-card";
      btn.type = "button";
      btn.innerHTML = `
        <div class="cow-card-main">
          <div class="brand">${escapeHtml(cow.brand)}</div>
          <div class="status">${latest ? `Last calving: ${monthName(latest.month)} ${latest.year}` : `Hasn't calved yet`}</div>
        </div>
        ${latest?.dead ? `<span class="dead-badge">Dead calf</span>` : ""}
      `;
      btn.addEventListener("click", () => {
        view.page = "cow";
        view.cowId = cow.id;
        render();
      });
      list.append(btn);
    });
  }

  const filterBar = document.getElementById("ownerFilterBar");
  if (view.ownerFilter) {
    filterBar.classList.remove("hidden");
    document.getElementById("ownerFilterText").textContent = `Owner: ${view.ownerFilter}`;
  }
  document.getElementById("clearOwnerBtn").addEventListener("click", () => { view.ownerFilter = ""; render(); });
  document.getElementById("allCowsBtn").addEventListener("click", () => { view.ownerFilter = ""; render(); });
  document.getElementById("ownersBtn").addEventListener("click", showOwnersModal);
  document.getElementById("addCowBtn").addEventListener("click", showAddCowModal);
  document.getElementById("menuBtn").addEventListener("click", showFarmMenu);

  renderNotes();
  setupNoteComposer();
}
function renderNotes() {
  const notesList = document.getElementById("notesList");
  const notes = [...state.notes].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (!notes.length) {
    notesList.innerHTML = `<div class="empty">No notes yet.</div>`;
    return;
  }
  notesList.innerHTML = notes.map(n => `
    <article class="note">
      <div class="note-meta">${escapeHtml(n.user)} · ${formatDateTime(n.timestamp)}</div>
      ${n.text ? `<p class="note-text">${escapeHtml(n.text)}</p>` : ""}
      ${n.photo ? `<img src="${n.photo}" alt="Farm note photo" />` : ""}
    </article>
  `).join("");
}
function setupNoteComposer() {
  const photoInput = document.getElementById("notePhoto");
  const previewWrap = document.getElementById("photoPreviewWrap");
  const preview = document.getElementById("photoPreview");

  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert("For this prototype, choose an image under 4 MB.");
      photoInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingPhoto = String(reader.result);
      preview.src = pendingPhoto;
      previewWrap.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("removePhotoBtn").addEventListener("click", () => {
    pendingPhoto = null;
    photoInput.value = "";
    preview.removeAttribute("src");
    previewWrap.classList.add("hidden");
  });

  document.getElementById("noteForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = document.getElementById("noteText").value.trim();
    if (!text && !pendingPhoto) return;
    state.notes.push({
      id: crypto.randomUUID(),
      user: state.currentUser,
      timestamp: new Date().toISOString(),
      text,
      photo: pendingPhoto
    });
    saveState();
    pendingPhoto = null;
    render();
  });
}
function renderCow() {
  const cow = state.cows.find(c => c.id === view.cowId);
  if (!cow) {
    view.page = "home";
    return render();
  }

  useTemplate("cow-template");
  document.getElementById("cowBrand").textContent = cow.brand;
  const ownerInput = document.getElementById("ownerInput");
  ownerInput.value = cow.owner || "";
  ownerInput.addEventListener("change", () => {
    cow.owner = ownerInput.value.trim();
    saveState();
  });

  const s = statsFor(cow);
  const stats = [
    [s.score == null ? "—" : `${s.score}/100`, "Overall score"],
    [formatPct(s.calvingRate), "Calving rate"],
    [formatPct(s.survival), "Calf survival"],
    [formatPct(s.deadRate), "Dead calf rate"],
    [formatInterval(s.avgInterval), "Avg. calving interval"],
    [String(s.total), "Lifetime calves"]
  ];
  document.getElementById("performanceGrid").innerHTML = stats.map(([v,l]) => `
    <div class="stat">
      <div class="stat-value">${v}</div>
      <div class="stat-label">${l}</div>
    </div>
  `).join("");

  const calfList = document.getElementById("calfList");
  const calves = sortedCalves(cow);
  if (!calves.length) {
    calfList.innerHTML = `<div class="empty">No calf records yet.</div>`;
  } else {
    calves.forEach(calf => {
      const btn = document.createElement("button");
      btn.className = "calf-card";
      btn.type = "button";
      const meta = [calf.gender, calf.color].filter(Boolean).join(" · ");
      btn.innerHTML = `
        <div class="calf-top">
          <span class="calf-date">${fullMonthName(calf.month)} ${calf.year}</span>
          ${calf.dead ? `<span class="dead-badge">Died</span>` : ""}
        </div>
        <div class="calf-meta">${meta || "No extra information"}</div>
      `;
      btn.addEventListener("click", () => showCalfModal(cow, calf));
      calfList.append(btn);
    });
  }

  document.getElementById("backBtn").addEventListener("click", () => { view.page = "home"; render(); });
  document.getElementById("addCalfBtn").addEventListener("click", () => showCalfModal(cow, null));
  document.getElementById("cowMenuBtn").addEventListener("click", () => showCowMenu(cow));
}
function openModal(html, onReady) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal">${html}</section></div>`;
  const backdrop = modalRoot.querySelector(".modal-backdrop");
  backdrop.addEventListener("click", e => {
    if (e.target === backdrop) closeModal();
  });
  onReady?.();
}
function closeModal() {
  modalRoot.innerHTML = "";
}
function showOwnersModal() {
  const owners = [...new Set(state.cows.map(c => c.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  openModal(`
    <div class="modal-card">
      <div class="section-heading">
        <div><p class="eyebrow">Filter herd</p><h2>Owners</h2></div>
        <button class="icon-button" id="closeModalBtn">×</button>
      </div>
      <div class="owner-list">
        ${owners.length ? owners.map(o => `<button class="owner-choice" data-owner="${escapeAttr(o)}">${escapeHtml(o)}</button>`).join("") : `<div class="empty">No owners have been added yet.</div>`}
      </div>
    </div>
  `, () => {
    document.getElementById("closeModalBtn").addEventListener("click", closeModal);
    modalRoot.querySelectorAll("[data-owner]").forEach(btn => btn.addEventListener("click", () => {
      view.ownerFilter = btn.dataset.owner;
      closeModal();
      render();
    }));
  });
}
function showAddCowModal() {
  openModal(`
    <form class="modal-card" id="addCowForm">
      <p class="eyebrow">New cow</p>
      <h2>Add brand number</h2>
      <div class="stack">
        <label><span>Brand number</span><input id="newBrand" required maxlength="30" inputmode="numeric" /></label>
        <label><span>Owner</span><input id="newOwner" maxlength="80" placeholder="Optional" /></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="soft" id="cancelCowBtn">Cancel</button>
        <button type="submit" class="primary">Add cow</button>
      </div>
    </form>
  `, () => {
    document.getElementById("cancelCowBtn").addEventListener("click", closeModal);
    document.getElementById("addCowForm").addEventListener("submit", e => {
      e.preventDefault();
      const brand = document.getElementById("newBrand").value.trim();
      const owner = document.getElementById("newOwner").value.trim();
      if (!brand) return;
      if (state.cows.some(c => c.brand.toLowerCase() === brand.toLowerCase())) {
        alert("That brand number already exists.");
        return;
      }
      state.cows.push({ id: crypto.randomUUID(), brand, owner, calves: [] });
      saveState();
      closeModal();
      render();
    });
  });
}
function showCalfModal(cow, calf) {
  const editing = Boolean(calf);
  const current = calf || { month: new Date().getMonth()+1, year: currentYear(), gender:"", color:"", dead:false };
  const months = Array.from({length:12}, (_,i)=>i+1);

  openModal(`
    <form class="modal-card" id="calfForm">
      <p class="eyebrow">${editing ? "Edit calf" : "New calf"}</p>
      <h2>${editing ? "Calf record" : `Add calf to ${escapeHtml(cow.brand)}`}</h2>
      <div class="stack">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label><span>Month</span><select id="calfMonth">${months.map(m=>`<option value="${m}" ${m===Number(current.month)?"selected":""}>${fullMonthName(m)}</option>`).join("")}</select></label>
          <label><span>Year</span><input id="calfYear" type="number" min="1900" max="2200" value="${current.year}" required /></label>
        </div>
        <label><span>Gender</span>
          <select id="calfGender">
            <option value="">Optional</option>
            <option ${current.gender==="Heifer"?"selected":""}>Heifer</option>
            <option ${current.gender==="Bull"?"selected":""}>Bull</option>
          </select>
        </label>
        <label><span>Color</span><input id="calfColor" maxlength="60" value="${escapeAttr(current.color || "")}" placeholder="Optional" /></label>
        <label class="checkbox-row">
          <input id="calfDead" type="checkbox" ${current.dead?"checked":""} />
          <span>${editing && !current.dead ? "Mark as died" : "Dead calf"}</span>
        </label>
      </div>
      <div class="modal-actions">
        ${editing ? `<button type="button" class="danger" id="deleteCalfBtn">Delete</button>` : ""}
        <button type="button" class="soft" id="cancelCalfBtn">Cancel</button>
        <button type="submit" class="primary">${editing ? "Save" : "Add calf"}</button>
      </div>
    </form>
  `, () => {
    document.getElementById("cancelCalfBtn").addEventListener("click", closeModal);
    if (editing) {
      document.getElementById("deleteCalfBtn").addEventListener("click", () => {
        if (!confirm("Delete this calf record?")) return;
        cow.calves = cow.calves.filter(c => c.id !== calf.id);
        saveState();
        closeModal();
        render();
      });
    }
    document.getElementById("calfForm").addEventListener("submit", e => {
      e.preventDefault();
      const record = {
        id: editing ? calf.id : crypto.randomUUID(),
        month: Number(document.getElementById("calfMonth").value),
        year: Number(document.getElementById("calfYear").value),
        gender: document.getElementById("calfGender").value,
        color: document.getElementById("calfColor").value.trim(),
        dead: document.getElementById("calfDead").checked
      };
      if (record.year < 1900 || record.year > 2200) return;
      if (editing) Object.assign(calf, record);
      else cow.calves.push(record);
      saveState();
      closeModal();
      render();
    });
  });
}
function showFarmMenu() {
  openModal(`
    <div class="modal-card">
      <div class="section-heading">
        <div><p class="eyebrow">Account</p><h2>${escapeHtml(state.currentUser)}</h2></div>
        <button class="icon-button" id="closeMenuBtn">×</button>
      </div>
      <div class="menu-list">
        <button class="soft" id="farmProfileBtn">Farm profile</button>
        <button class="soft" id="logoutBtn">Log out</button>
      </div>
    </div>
  `, () => {
    document.getElementById("closeMenuBtn").addEventListener("click", closeModal);
    document.getElementById("farmProfileBtn").addEventListener("click", showFarmProfile);
    document.getElementById("logoutBtn").addEventListener("click", () => {
      state.currentUser = "";
      saveState();
      closeModal();
      view.page = "login";
      render();
    });
  });
}
function showFarmProfile() {
  openModal(`
    <form class="modal-card" id="farmProfileForm">
      <p class="eyebrow">Settings</p>
      <h2>Farm profile</h2>
      <div class="stack">
        <label><span>Farm name</span><input id="farmNameInput" maxlength="100" value="${escapeAttr(state.farmName || "")}" /></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="soft" id="cancelFarmBtn">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  `, () => {
    document.getElementById("cancelFarmBtn").addEventListener("click", closeModal);
    document.getElementById("farmProfileForm").addEventListener("submit", e => {
      e.preventDefault();
      state.farmName = document.getElementById("farmNameInput").value.trim() || "Cattle Records";
      saveState();
      closeModal();
      render();
    });
  });
}
function showCowMenu(cow) {
  openModal(`
    <div class="modal-card">
      <p class="eyebrow">Cow ${escapeHtml(cow.brand)}</p>
      <h2>Options</h2>
      <div class="menu-list" style="margin-top:14px">
        <button class="danger" id="deleteCowBtn">Delete cow</button>
        <button class="soft" id="closeCowMenuBtn">Cancel</button>
      </div>
    </div>
  `, () => {
    document.getElementById("closeCowMenuBtn").addEventListener("click", closeModal);
    document.getElementById("deleteCowBtn").addEventListener("click", () => {
      if (!confirm(`Delete cow ${cow.brand} and all of her calf records?`)) return;
      state.cows = state.cows.filter(c => c.id !== cow.id);
      saveState();
      closeModal();
      view.page = "home";
      render();
    });
  });
}
function formatDateTime(iso) {
  return new Intl.DateTimeFormat("en", {
    year:"numeric", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"
  }).format(new Date(iso));
}
function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function escapeAttr(value="") {
  return escapeHtml(value).replace(/`/g,"&#096;");
}

render();
