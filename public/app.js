const cities = [
  "連江縣", "金門縣", "澎湖縣", "基隆市", "新北市", "台北市", "桃園市", "新竹縣", "新竹市", "苗栗縣",
  "台中市", "彰化縣", "雲林縣", "南投縣", "嘉義縣", "嘉義市", "台南市", "高雄市", "屏東縣", "台東縣", "花蓮縣", "宜蘭縣"
];

let iccItems = [];
let records = [];
let adminToken = localStorage.getItem("cleanocean_admin_token") || "";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const number = (value) => Number(value || 0);

function formatStatus(status) {
  const map = { pending: "待審", approved: "已確認", hidden: "下架" };
  return `<span class="status ${status}">${map[status] || status}</span>`;
}

function fillCitySelects() {
  $$("select[name='city']").forEach((select) => {
    const required = select.hasAttribute("required");
    select.innerHTML = `${required ? "" : "<option value=''>全部縣市</option>"}${cities.map((city) => `<option value="${city}">${city}</option>`).join("")}`;
  });
}

function setupViews() {
  const show = (id) => {
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
    $$("[data-view-link]").forEach((link) => link.classList.toggle("active", link.dataset.viewLink === id));
    if (id === "stats") loadStats();
    if (id === "download") loadRecords();
    if (id === "map") loadMap();
    if (id === "admin" && adminToken) loadAdminRecords();
  };

  $$("[data-view-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const id = link.dataset.viewLink;
      history.replaceState(null, "", `#${id}`);
      show(id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  window.addEventListener("hashchange", () => show(location.hash.replace("#", "") || "home"));
  show(location.hash.replace("#", "") || "home");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "x-admin-token": adminToken } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function loadConfig() {
  const config = await api("/api/config");
  iccItems = config.iccItems;
  $("#iccInputs").innerHTML = iccItems.map(([code, name]) => `
    <label>${name}<input name="icc_${code}" type="number" min="0" value="0" inputmode="numeric"></label>
  `).join("");
}

async function loadHomeStats() {
  const stats = await api("/api/stats");
  renderMetrics($("#homeMetrics"), stats.totals);
}

function renderMetrics(container, totals) {
  container.innerHTML = [
    ["總場次", totals.sessions, "場"],
    ["總人次", totals.people, "人"],
    ["總重量", Math.round(totals.weight * 10) / 10, "公斤"],
    ["總長度", Math.round(totals.length * 10) / 10, "公尺"]
  ].map(([label, value, unit]) => `
    <div class="metric"><strong>${Number(value).toLocaleString()}</strong><span>${label} / ${unit}</span></div>
  `).join("");
}

async function loadStats() {
  const stats = await api("/api/stats");
  renderMetrics($("#statsMetrics"), stats.totals);
  const max = Math.max(...stats.topItems.map((item) => item.count), 1);
  $("#topChart").innerHTML = stats.topItems.map((item) => `
    <div class="bar-row">
      <span>${item.name}</span>
      <div class="bar" style="width:${Math.max(3, item.count / max * 100)}%"></div>
      <strong>${item.count}</strong>
    </div>
  `).join("");
  $("#cityStats").innerHTML = stats.byCity.length
    ? stats.byCity.map((city) => `
      <div class="city-item">
        <strong>${city.city}</strong>
        <div>${city.sessions} 場 / ${city.people} 人 / ${Math.round(city.weight * 10) / 10} kg</div>
      </div>
    `).join("")
    : "<p>尚無已確認資料。</p>";
}

function recordPayload(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const counts = {};
  for (const [code] of iccItems) counts[code] = number(data[`icc_${code}`]);
  const others = [1, 2, 3].map((i) => ({
    name: data[`otherName${i}`]?.trim(),
    count: number(data[`otherCount${i}`])
  })).filter((item) => item.name);

  return {
    date: data.date,
    city: data.city,
    location: data.location,
    lat: data.lat === "" ? null : number(data.lat),
    lng: data.lng === "" ? null : number(data.lng),
    organization: data.organization,
    participants: number(data.participants),
    lengthM: data.lengthM === "" ? null : number(data.lengthM),
    weightKg: data.weightKg === "" ? null : number(data.weightKg),
    email: data.email,
    photo: data.photo || "/assets/beach-hero.jpg",
    notes: data.notes,
    status: "pending",
    counts,
    safety: {
      fishHooks: number(data.fishHooks),
      metalItems: number(data.metalItems)
    },
    others
  };
}

function setupRecordForm() {
  const form = $("#recordForm");
  form.date.value = new Date().toISOString().slice(0, 10);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#formMessage").textContent = "送出中...";
    try {
      const { record } = await api("/api/records", { method: "POST", body: JSON.stringify(recordPayload(form)) });
      $("#formMessage").textContent = `已送出，資料編號：${record.id}。管理者可到後台審核。`;
      form.reset();
      form.date.value = new Date().toISOString().slice(0, 10);
      await loadHomeStats();
    } catch (error) {
      $("#formMessage").textContent = `送出失敗：${error.message}`;
    }
  });
}

function filterQuery(form) {
  const params = new URLSearchParams(new FormData(form));
  [...params.entries()].forEach(([key, value]) => { if (!value) params.delete(key); });
  return params.toString();
}

async function loadRecords() {
  const query = filterQuery($("#filterForm"));
  $("#csvDownload").href = `/api/export.csv${query ? `?${query}` : ""}`;
  const data = await api(`/api/records?status=all${query ? `&${query}` : ""}`);
  records = data.records;
  $("#recordsTable").innerHTML = records.map((r) => `
    <tr>
      <td>${r.date}</td>
      <td>${r.city}<br><small>${r.location || ""}</small></td>
      <td>${r.organization}</td>
      <td>${r.participants}</td>
      <td>${r.weightKg ?? ""}</td>
      <td>${formatStatus(r.status)}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">沒有符合條件的資料</td></tr>`;
}

function setupFilterForm() {
  $("#filterForm").addEventListener("submit", (event) => {
    event.preventDefault();
    loadRecords();
  });
}

async function loadMap() {
  const data = await api("/api/records?status=approved");
  const approved = data.records;
  $("#mapPins").innerHTML = approved.map((r, index) => {
    const x = 48 + ((r.lng || 121) - 120.2) * 22 + index * 1.4;
    const y = 60 - ((r.lat || 24) - 23.3) * 20 + index * 1.2;
    return `<span class="pin" title="${r.city} ${r.location}" style="left:${Math.max(12, Math.min(88, x))}%;top:${Math.max(10, Math.min(90, y))}%"></span>`;
  }).join("");
  $("#mapList").innerHTML = approved.map((r) => `
    <article class="record-card">
      <h3>${r.city} · ${r.location || "未填地點"}</h3>
      <p>${r.date} / ${r.organization} / ${r.participants} 人 / ${r.weightKg ?? 0} kg</p>
      <p>安全評估：魚鉤 ${r.safety?.fishHooks || 0}、金屬製品 ${r.safety?.metalItems || 0}</p>
    </article>
  `).join("") || "<p>尚無已確認資料。</p>";
}

function setupAdmin() {
  $("#adminLoginButton").addEventListener("click", async () => {
    adminToken = $("#adminPassword").value;
    localStorage.setItem("cleanocean_admin_token", adminToken);
    try {
      await loadAdminRecords();
      $("#adminLogin").classList.add("hidden");
      $("#adminPanel").classList.remove("hidden");
    } catch {
      alert("密碼錯誤，請輸入 cleanocean-admin");
      adminToken = "";
      localStorage.removeItem("cleanocean_admin_token");
    }
  });

  $$("[data-admin-status]").forEach((button) => {
    button.addEventListener("click", () => loadAdminRecords(button.dataset.adminStatus));
  });

  if (adminToken) {
    $("#adminLogin").classList.add("hidden");
    $("#adminPanel").classList.remove("hidden");
  }
}

async function loadAdminRecords(status = "all") {
  const data = await api(`/api/records?status=${status}`);
  $("#adminRecords").innerHTML = data.records.map((r) => `
    <article class="admin-record">
      <div>
        <h3>${r.date} ${r.city} ${r.location || ""} ${formatStatus(r.status)}</h3>
        <p>${r.organization} / ${r.participants} 人 / ${r.weightKg ?? 0} kg / ${r.lengthM ?? 0} m</p>
        <p>Email：${r.email || "未填"}；備註：${r.notes || "無"}</p>
      </div>
      <div class="admin-actions">
        <button class="button secondary" data-action="approved" data-id="${r.id}">確認</button>
        <button class="button secondary" data-action="pending" data-id="${r.id}">待審</button>
        <button class="button secondary" data-action="hidden" data-id="${r.id}">下架</button>
        <button class="button secondary" data-action="delete" data-id="${r.id}">刪除</button>
      </div>
    </article>
  `).join("") || "<p>沒有資料。</p>";

  $$("#adminRecords [data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;
      if (action === "delete") {
        if (!confirm("確定刪除這筆資料？")) return;
        await api(`/api/records/${id}`, { method: "DELETE" });
      } else {
        await api(`/api/records/${id}`, { method: "PATCH", body: JSON.stringify({ status: action }) });
      }
      await loadAdminRecords(status);
      await loadHomeStats();
    });
  });
}

async function init() {
  fillCitySelects();
  await loadConfig();
  setupViews();
  setupRecordForm();
  setupFilterForm();
  setupAdmin();
  await loadHomeStats();
  await loadRecords();
}

init().catch((error) => {
  console.error(error);
  alert(`網站初始化失敗：${error.message}`);
});
