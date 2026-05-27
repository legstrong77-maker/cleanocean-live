const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const root = __dirname;
const publicDir = path.join(root, "public");
const dataFile = path.join(root, "data", "records.json");
const port = Number(process.env.PORT || 8790);
const host = process.env.HOST || "0.0.0.0";
const adminToken = process.env.ADMIN_TOKEN || "cleanocean-admin";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const iccItems = [
  ["pet_bottles", "寶特瓶"],
  ["bottle_caps", "塑膠瓶蓋"],
  ["food_containers", "其他飲料瓶與食物容器"],
  ["non_food_containers", "非食物瓶罐與容器"],
  ["plastic_bags", "塑膠提袋"],
  ["food_wrappers", "食品包裝袋"],
  ["straws", "吸管"],
  ["cups", "外帶飲料杯"],
  ["tableware", "免洗餐具"],
  ["cans", "鐵鋁罐"],
  ["cartons", "鋁箔包或利樂包"],
  ["glass_bottles", "玻璃瓶"],
  ["fishing_gear", "釣魚用具"],
  ["floats", "漁業浮球、浮筒、漁船防碰墊"],
  ["nets_ropes", "漁網與繩子"],
  ["cigarettes", "菸蒂"],
  ["toothbrushes", "牙刷"],
  ["syringes", "針筒、針頭"],
  ["lighters", "打火機"]
];

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function loadRecords() {
  return JSON.parse(await fs.readFile(dataFile, "utf8"));
}

async function saveRecords(records) {
  await fs.writeFile(dataFile, JSON.stringify(records, null, 2), "utf8");
}

function filterRecords(records, url) {
  const city = url.searchParams.get("city") || "";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const status = url.searchParams.get("status") || "";

  return records.filter((r) => {
    if (city && r.city !== city) return false;
    if (status && status !== "all" && r.status !== status) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (q) {
      const haystack = `${r.location || ""} ${r.organization || ""} ${r.city || ""} ${r.email || ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function buildStats(records) {
  const approved = records.filter((r) => r.status === "approved");
  const totals = approved.reduce((acc, r) => {
    acc.sessions += 1;
    acc.people += Number(r.participants || 0);
    acc.weight += Number(r.weightKg || 0);
    acc.length += Number(r.lengthM || 0);
    return acc;
  }, { sessions: 0, people: 0, weight: 0, length: 0 });

  const itemTotals = Object.fromEntries(iccItems.map(([code, name]) => [code, { code, name, count: 0 }]));
  for (const r of approved) {
    for (const [code] of iccItems) itemTotals[code].count += Number(r.counts?.[code] || 0);
  }
  const topItems = Object.values(itemTotals).sort((a, b) => b.count - a.count).slice(0, 10);

  const byCity = {};
  for (const r of approved) {
    byCity[r.city] ||= { city: r.city, sessions: 0, weight: 0, people: 0 };
    byCity[r.city].sessions += 1;
    byCity[r.city].weight += Number(r.weightKg || 0);
    byCity[r.city].people += Number(r.participants || 0);
  }

  return { totals, topItems, byCity: Object.values(byCity).sort((a, b) => b.sessions - a.sessions) };
}

function requireAdmin(req, res) {
  if (req.headers["x-admin-token"] === adminToken) return true;
  json(res, 401, { error: "admin_required" });
  return false;
}

function cleanRecord(input, id) {
  const counts = {};
  for (const [code] of iccItems) counts[code] = Math.max(0, Number(input.counts?.[code] || 0));

  return {
    id: id || `rec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: String(input.date || new Date().toISOString().slice(0, 10)),
    city: String(input.city || ""),
    location: String(input.location || ""),
    lat: input.lat === "" || input.lat == null ? null : Number(input.lat),
    lng: input.lng === "" || input.lng == null ? null : Number(input.lng),
    organization: String(input.organization || ""),
    participants: Math.max(1, Number(input.participants || 1)),
    lengthM: input.lengthM === "" || input.lengthM == null ? null : Number(input.lengthM),
    weightKg: input.weightKg === "" || input.weightKg == null ? null : Number(input.weightKg),
    email: String(input.email || ""),
    status: ["pending", "approved", "hidden"].includes(input.status) ? input.status : "pending",
    notes: String(input.notes || ""),
    counts,
    safety: {
      fishHooks: Math.max(0, Number(input.safety?.fishHooks || 0)),
      metalItems: Math.max(0, Number(input.safety?.metalItems || 0))
    },
    others: Array.isArray(input.others)
      ? input.others.filter((o) => o && o.name).slice(0, 3).map((o) => ({ name: String(o.name), count: Math.max(0, Number(o.count || 0)) }))
      : [],
    photo: String(input.photo || "/assets/beach-hero.jpg"),
    createdAt: input.createdAt || new Date().toISOString()
  };
}

function toCsv(records, includeEmail) {
  const header = [
    "日期", "縣市", "地點", "緯度", "經度", "單位", "參與人數", "潔淨長度m", "總重量kg",
    ...(includeEmail ? ["登記者Email"] : []),
    ...iccItems.map(([, name]) => name),
    "魚鉤", "金屬製品", "其他廢棄物", "備註", "狀態"
  ];
  const rows = records.map((r) => [
    r.date, r.city, r.location, r.lat ?? "", r.lng ?? "", r.organization, r.participants, r.lengthM ?? "", r.weightKg ?? "",
    ...(includeEmail ? [r.email || ""] : []),
    ...iccItems.map(([code]) => r.counts?.[code] || 0),
    r.safety?.fishHooks || 0,
    r.safety?.metalItems || 0,
    (r.others || []).map((o) => `${o.name}:${o.count}`).join("; "),
    r.notes || "",
    r.status
  ]);
  return "\uFEFF" + [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/config") return json(res, 200, { iccItems, adminHint: "本機後台密碼：cleanocean-admin" });

  if (url.pathname === "/api/stats") {
    const records = await loadRecords();
    return json(res, 200, buildStats(records));
  }

  if (url.pathname === "/api/export.csv") {
    const records = filterRecords(await loadRecords(), url);
    const includeEmail = url.searchParams.get("includeEmail") === "1";
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=cleanocean-icc.csv"
    });
    return res.end(toCsv(records, includeEmail));
  }

  if (url.pathname === "/api/records" && req.method === "GET") {
    const records = filterRecords(await loadRecords(), url).sort((a, b) => b.date.localeCompare(a.date));
    return json(res, 200, { records });
  }

  if (url.pathname === "/api/records" && req.method === "POST") {
    const input = await readBody(req);
    if (!input.city || !input.organization || !input.email) return json(res, 400, { error: "missing_required_fields" });
    const records = await loadRecords();
    const record = cleanRecord(input);
    records.unshift(record);
    await saveRecords(records);
    return json(res, 201, { record });
  }

  const match = url.pathname.match(/^\/api\/records\/([^/]+)$/);
  if (match && req.method === "PATCH") {
    if (!requireAdmin(req, res)) return;
    const input = await readBody(req);
    const records = await loadRecords();
    const index = records.findIndex((r) => r.id === match[1]);
    if (index < 0) return json(res, 404, { error: "not_found" });
    records[index] = cleanRecord({ ...records[index], ...input }, records[index].id);
    await saveRecords(records);
    return json(res, 200, { record: records[index] });
  }

  if (match && req.method === "DELETE") {
    if (!requireAdmin(req, res)) return;
    const records = await loadRecords();
    const next = records.filter((r) => r.id !== match[1]);
    await saveRecords(next);
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: "api_not_found" });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(publicDir, pathname));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const buffer = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(buffer);
  } catch {
    const index = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(index);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "server_error", message: String(error.message || error) });
  }
});

server.listen(port, host, () => {
  const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`愛海小旅行網站已啟動：http://${shownHost}:${port}`);
});
