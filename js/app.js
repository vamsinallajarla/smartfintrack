// SmartFinTrack main script (store + UI in one classic script, so index.html also works by double-click)

const firebaseConfig = window.firebaseConfig;
const configured = !!(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_"));
const mode = configured ? "firebase" : "demo";

const COLS = ["transactions", "budgets", "investments", "accounts", "goals", "cards", "subs"];
const data = { transactions: [], budgets: [], investments: [], accounts: [], goals: [], cards: [], subs: [] };
let user = null;
let authReady = false;

const listeners = new Set();
const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
let fb = null;
let unsubs = [];

// ---------- demo mode (localStorage) ----------
const LS_KEY = "smartfintrack-demo-v1";
const saveLocal = () => localStorage.setItem(LS_KEY, JSON.stringify(data));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

const demoCards = () => [
  { name: "HDFC Regalia", network: "Visa", last4: "4821", limit: 150000, outstanding: 18000, dueDay: 18 },
  { name: "ICICI Amazon Pay", network: "Mastercard", last4: "7305", limit: 80000, outstanding: 6500, dueDay: 5 }
].map((c) => ({ id: uid(), ...c }));

const demoSubs = () => [
  { name: "Netflix", category: "OTT", amount: 649, cycle: "monthly", day: 12, month: null, active: true },
  { name: "iCloud+", category: "Apple", amount: 219, cycle: "monthly", day: 3, month: null, active: true },
  { name: "Google One", category: "Google One", amount: 130, cycle: "monthly", day: 20, month: null, active: true },
  { name: "Spotify", category: "Music", amount: 119, cycle: "monthly", day: 8, month: null, active: true },
  { name: "Amazon Prime", category: "OTT", amount: 1499, cycle: "yearly", day: 15, month: 6, active: true }
].map((x) => ({ id: uid(), ...x }));

const demoGoals = () => [
  { name: "Emergency reserve", target: 300000, saved: 200000 },
  { name: "Europe trip", target: 250000, saved: 90000 },
  { name: "New laptop", target: 120000, saved: 45000 }
].map((g) => ({ id: uid(), ...g }));

function seedDemo() {
  const d = (m, day) => {
    const t = new Date(); t.setMonth(t.getMonth() - m, day);
    return t.toISOString().slice(0, 10);
  };
  const tx = [];
  for (let m = 0; m < 6; m++) {
    tx.push({ type: "income", category: "Salary", amount: 85000, date: d(m, 1), note: "Monthly salary" });
    tx.push({ type: "expense", category: "Rent", amount: 22000, date: d(m, 3), note: "" });
    tx.push({ type: "expense", category: "Food", amount: 8000 + m * 400, date: d(m, 10), note: "Groceries & dining" });
    tx.push({ type: "expense", category: "Transport", amount: 3000, date: d(m, 12), note: "" });
    tx.push({ type: "expense", category: "Utilities", amount: 2800, date: d(m, 15), note: "" });
    tx.push({ type: "expense", category: "Shopping", amount: 4000 + (m % 3) * 1500, date: d(m, 20), note: "" });
    tx.push({ type: "expense", category: "Subscriptions", amount: 649, date: d(m, 12), note: "Netflix" });
    tx.push({ type: "expense", category: "Subscriptions", amount: 219, date: d(m, 3), note: "iCloud+" });
    tx.push({ type: "expense", category: "Subscriptions", amount: 119, date: d(m, 8), note: "Spotify" });
    if (m > 0) tx.push({ type: "expense", category: "Subscriptions", amount: 130, date: d(m, 20), note: "Google One" });
  }
  data.transactions = tx.map((t) => ({ id: uid(), ...t }));
  data.budgets = [
    { category: "Food", limit: 10000 }, { category: "Shopping", limit: 5000 },
    { category: "Transport", limit: 3500 }, { category: "Entertainment", limit: 3000 }
  ].map((b) => ({ id: uid(), ...b }));
  data.investments = [
    { name: "Nifty 50 Index Fund", type: "Mutual Fund", invested: 150000, current: 172000 },
    { name: "Reliance Industries", type: "Stock", invested: 60000, current: 66500 },
    { name: "PPF", type: "Fixed Income", invested: 120000, current: 131000 }
  ].map((i) => ({ id: uid(), ...i }));
  data.accounts = [
    { name: "Savings Account", kind: "bank account", value: 240000 },
    { name: "Emergency Fund (FD)", kind: "asset", value: 200000 },
    { name: "Education Loan", kind: "liability", value: 350000 }
  ].map((a) => ({ id: uid(), ...a }));
  data.goals = demoGoals();
  data.cards = demoCards();
  data.subs = demoSubs();
  saveLocal();
}

// ---------- init ----------
async function init() {
  if (mode === "demo") {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { try { const p = JSON.parse(raw); Object.assign(data, p); if (p.goals === undefined) { data.goals = demoGoals(); saveLocal(); }
      if (p.subs === undefined) { data.subs = demoSubs(); saveLocal(); }
      if (p.cards === undefined) { data.cards = demoCards(); data.accounts = data.accounts.filter((a) => !(a.name === "Credit Card" && a.kind === "liability")); saveLocal(); } } catch { seedDemo(); } } else seedDemo();
    emit();
    return;
  }
  const [app, auth, fs] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")
  ]);
  const a = app.initializeApp(firebaseConfig);
  fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), ...auth, ...fs };
  fb.onAuthStateChanged(fb.auth, (u) => {
    user = u; authReady = true;
    unsubs.forEach((f) => f()); unsubs = [];
    COLS.forEach((c) => (data[c] = []));
    if (u) {
      COLS.forEach((c) => {
        unsubs.push(fb.onSnapshot(fb.collection(fb.db, "users", u.uid, c), (snap) => {
          data[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          emit();
        }));
      });
    }
    emit();
  });
}

function authToast(msg) {
  document.getElementById("authToast")?.remove();
  const t = document.createElement("div");
  t.id = "authToast"; t.className = "imptoast"; t.style.background = "#a33a4a"; t.style.maxWidth = "420px"; t.style.whiteSpace = "pre-wrap";
  t.textContent = msg; t.onclick = () => t.remove();
  document.body.appendChild(t); setTimeout(() => t.remove(), 20000);
}
const AUTH_HELP = {
  "auth/unauthorized-domain": "This site's address isn't allowed for sign-in. In Firebase: Authentication > Settings > Authorized domains > add: " + location.hostname,
  "auth/operation-not-supported-in-this-environment": "Sign-in needs http(s). Open the site from your GitHub Pages address or http://localhost, not by double-clicking the file.",
  "auth/popup-blocked": "The browser blocked the sign-in popup. Allow popups for this site and try again.",
  "auth/popup-closed-by-user": "The sign-in window closed before finishing. If it closes by itself, check the browser's popup/cookie settings and Firebase's authorized domains.",
  "auth/cancelled-popup-request": "Another sign-in window was already open. Close it and try again.",
  "auth/network-request-failed": "Network problem while signing in. Check your connection and try again.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The Firebase API key was rejected. Check js/firebase-config.js and the key's website restrictions in Google Cloud.",
  "auth/invalid-api-key": "The Firebase API key was rejected. Check js/firebase-config.js and the key's website restrictions in Google Cloud.",
};
async function login() {
  if (location.protocol === "file:") { authToast(AUTH_HELP["auth/operation-not-supported-in-this-environment"]); return; }
  try {
    await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
  } catch (e) {
    console.error("Sign-in failed:", e);
    authToast("Sign-in failed (" + (e.code || "unknown") + ")\n" + (AUTH_HELP[e.code] || e.message || "") + "\nHostname: " + location.hostname);
  }
}
const logout = () => fb.signOut(fb.auth);

// ---------- CRUD ----------
const APP_BUILD = 43;
// run a Firebase write; show the real reason on screen instead of failing silently
async function fbWrite(what, fn) {
  try { return await fn(); }
  catch (e) {
    console.error("Save failed:", what, e);
    const code = e && (e.code || e.message) || "unknown";
    authToast(`Couldn't ${what}: ${code}` + (/permission/.test(code) ? "\nFirestore rules rejected the write. Check you are signed in and the rules are published." : ""));
    throw e;
  }
}
async function add(col, obj) {
  if (mode === "demo") { data[col].push({ id: uid(), ...obj }); saveLocal(); emit(); return; }
  if (!user) { authToast("You are signed out. Sign in again to save."); return; }
  await fbWrite("save to " + col, () => fb.addDoc(fb.collection(fb.db, "users", user.uid, col), obj));
}
async function remove(col, id) {
  if (mode === "demo") { data[col] = data[col].filter((x) => x.id !== id); saveLocal(); emit(); return; }
  await fbWrite("delete from " + col, () => fb.deleteDoc(fb.doc(fb.db, "users", user.uid, col, id)));
}
async function update(col, id, patch) {
  if (mode === "demo") { const x = data[col].find((r) => r.id === id); if (x) Object.assign(x, patch); saveLocal(); emit(); return; }
  await fbWrite("update " + col, () => fb.updateDoc(fb.doc(fb.db, "users", user.uid, col, id), patch));
}
// safety net: a form without a working handler must never reload the page
document.addEventListener("submit", (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  console.error("Form submitted without a handler", e.target);
  authToast("This page didn't finish loading (build " + APP_BUILD + "). Press Ctrl+Shift+R and try again. If it repeats, tell me what the browser console shows.");
});
async function resetDemo() {
  if (mode !== "demo") return;
  localStorage.removeItem(LS_KEY); seedDemo(); emit();
}


const INCOME_CATS = ["Salary", "Business", "Interest", "Other"];
const XFER_CATS = ["Own account", "Loan repayment", "Card bill", "FD / RD"];
const ACCT_ROLES = ["Savings", "Salary", "Current", "UPI spend", "Loan", "Other"];
const EXPENSE_CATS = ["Food", "Rent", "Transport", "Utilities", "Shopping", "Health", "Entertainment", "Subscriptions", "Other"];
const INV_TYPES = ["Stock", "Mutual Fund", "FD", "RD", "Fixed Income", "Gold", "Crypto", "Other"];
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pal = () => ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"].map(css);

const $app = document.getElementById("app");
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmt = (n) => inr.format(n || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const txAmt = (t) => (t.type === "transfer" ? `⇄ ${fmt(t.amount)}` : `${t.type === "income" ? "+" : "−"}${fmt(t.amount)}`);
const txCls = (t) => (t.type === "income" ? "good" : t.type === "transfer" ? "muted" : "bad");
const opts = (arr, sel) => arr.map((x) => `<option${x === sel ? " selected" : ""}>${esc(x)}</option>`).join("");
const monthKey = (d) => String(d).slice(0, 7);
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
const todayStr = () => isoDate(new Date());
const thisMonth = () => todayStr().slice(0, 7);
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

let view = "overview";
const F = { mode: "month", month: thisMonth(), year: String(new Date().getFullYear()), from: "", to: "", type: "all", cat: "all", q: "" };
const FKEY = "smartfintrack-filters-v1";
try { Object.assign(F, JSON.parse(localStorage.getItem(FKEY) || "{}")); } catch {}
if (!["month", "year", "range", "all"].includes(F.mode)) F.mode = "month";
F.q = "";
const saveFilters = () => { try { localStorage.setItem(FKEY, JSON.stringify(F)); } catch {} };
const inSel = (t) => {
  const d = String(t.date);
  if (F.mode === "all") return true;
  if (F.mode === "month") return d.slice(0, 7) === F.month;
  if (F.mode === "year") return d.slice(0, 4) === F.year;
  return (!F.from || d >= F.from) && (!F.to || d <= F.to);
};
const budgetMonth = () => (F.mode === "month" ? F.month : thisMonth());
const periodLabel = () => F.mode === "all" ? "All time" : F.mode === "month" ? monthLabel(F.month) : F.mode === "year" ? F.year : `${F.from || "start"} → ${F.to || "today"}`;
const endMonth = () => {
  if (F.mode === "month") return F.month;
  if (F.mode === "year") return F.year === String(new Date().getFullYear()) ? thisMonth() : `${F.year}-12`;
  if (F.mode === "range" && F.to) return F.to.slice(0, 7);
  return thisMonth();
};
const monthLabel = (k) => { const [y, m] = k.split("-"); return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" }); };
let charts = [];

const mixW = (h, t) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return h; const n = parseInt(m[1], 16); const f = (c) => Math.round(c + (255 - c) * t); return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`; };
const lighten = mixW;
const gradBg = (cols) => (ctx) => {
  const col = Array.isArray(cols) ? cols[(ctx.dataIndex || 0) % cols.length] : cols;
  const a = ctx.chart.chartArea;
  if (!a || !col) return col || "#888";
  const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
  g.addColorStop(0, mixW(col, 0.2)); g.addColorStop(1, col);
  return g;
};
const glowPlugin = {
  id: "glow",
  beforeDatasetDraw(c, args) { const ds = c.data.datasets[args.index]; if (!ds.glow) return; c.ctx.save(); c.ctx.shadowColor = ds.glowColor || ds.borderColor; c.ctx.shadowBlur = 8; c.ctx.shadowOffsetY = 3; },
  afterDatasetDraw(c, args) { if (c.data.datasets[args.index].glow) c.ctx.restore(); }
};
function chart(id, cfg) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  const style = getComputedStyle(document.documentElement);
  Chart.defaults.color = style.getPropertyValue("--muted").trim() || "#6b7280";
  Chart.defaults.borderColor = style.getPropertyValue("--line").trim() || "#e5e7eb";
  try {
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = "rgba(14,12,36,.88)"; tt.titleColor = "#fff"; tt.bodyColor = "#e6e3ff"; tt.cornerRadius = 12; tt.padding = 10;
    tt.borderColor = "rgba(255,255,255,.18)"; tt.borderWidth = 1; tt.boxPadding = 4; tt.usePointStyle = true;
  } catch {}
  cfg.options = { responsive: true, maintainAspectRatio: false,
    animation: { duration: 1100, easing: "easeOutQuart", delay: (c) => (c.type === "data" && c.mode === "default" ? c.dataIndex * 70 : 0) },
    ...(cfg.options || {}) };
  cfg.plugins = [...(cfg.plugins || []), glowPlugin];
  try { charts.push(new Chart(el, cfg)); } catch (e) { console.error("Chart failed:", e); } // never let a chart error stop the page's forms from binding
}

function lastMonths(n) {
  const out = [];
  const t = new Date(+endMonth().slice(0, 4), +endMonth().slice(5, 7) - 1, 1);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function netWorth() {
  const assets = sum(data.accounts.filter((a) => a.kind !== "liability"), (a) => a.value);
  const cardDues = sum(data.cards, (c) => c.outstanding);
  const liabilities = sum(data.accounts.filter((a) => a.kind === "liability"), (a) => a.value) + cardDues;
  const invested = sum(data.investments, (i) => i.current);
  return { assets, liabilities, cardDues, invested, total: assets + invested - liabilities };
}

// ---------- views ----------
const hasPrev = () => F.mode === "month" || F.mode === "year" || (F.mode === "range" && F.from && F.to);
function inPrev(t) {
  const d = String(t.date);
  if (F.mode === "month") return d.slice(0, 7) === isoDate(new Date(+F.month.slice(0, 4), +F.month.slice(5, 7) - 2, 1)).slice(0, 7);
  if (F.mode === "year") return d.slice(0, 4) === String(+F.year - 1);
  const a = new Date(F.from + "T00:00:00"), b = new Date(F.to + "T00:00:00");
  const days = Math.round((b - a) / 864e5) + 1;
  const pe = new Date(a.getTime() - 864e5), ps = new Date(pe.getTime() - (days - 1) * 864e5);
  return d >= isoDate(ps) && d <= isoDate(pe);
}
const chgHtml = (cur, prev, goodUp) => {
  if (!hasPrev() || !prev) return `<span class="muted">no previous period</span>`;
  const pct = ((cur - prev) / Math.abs(prev)) * 100, up = pct >= 0;
  return `<span class="chg ${up === goodUp ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%</span> <span class="muted">vs last period</span>`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function bucketize(tx) {
  let labels, key;
  if (F.mode === "month") {
    const dim = new Date(+F.month.slice(0, 4), +F.month.slice(5, 7), 0).getDate();
    labels = ["Days 1–7", "8–14", "15–21", "22–28", "29+"].slice(0, dim > 28 ? 5 : 4);
    key = (t) => Math.min(labels.length - 1, Math.floor((+String(t.date).slice(8, 10) - 1) / 7));
  } else if (F.mode === "year") {
    labels = MONTHS; key = (t) => +String(t.date).slice(5, 7) - 1;
  } else {
    const ks = [...new Set(tx.map((t) => monthKey(t.date)))].sort().slice(-12);
    labels = ks.map((k) => `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}`);
    key = (t) => ks.indexOf(monthKey(t.date));
  }
  const inc = labels.map(() => 0), exp = labels.map(() => 0);
  tx.forEach((t) => { const i = key(t); if (i < 0) return; if (t.type === "transfer") return; (t.type === "income" ? inc : exp)[i] += Number(t.amount) || 0; });
  return { labels, inc, exp, sav: inc.map((v, k) => v - exp[k]) };
}
const catColor = (c) => pal()[[...new Set([...EXPENSE_CATS, ...INCOME_CATS])].indexOf(c) % 6] || css("--c6");
const budgetSpent = (cat, m) => sum(data.transactions.filter((t) => t.type === "expense" && t.category === cat && monthKey(t.date) === m), (t) => t.amount);
function overBudget() {
  const m = budgetMonth();
  return data.budgets.map((b) => ({ category: b.category, over: budgetSpent(b.category, m) - b.limit })).filter((x) => x.over > 0);
}

let balView = "trend";
let animateNext = true;
const compact = (n) => { const a = Math.abs(n); return (n < 0 ? "-" : "") + "₹" + (a >= 1e7 ? (a / 1e7).toFixed(1) + "Cr" : a >= 1e5 ? (a / 1e5).toFixed(1) + "L" : a >= 1e3 ? (a / 1e3).toFixed(1) + "k" : Math.round(a)); };
const hexA = (h, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return h; const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

let sparkN = 0;
function spark(vals, colorVar) {
  const gid = "sg" + ++sparkN;
  const w = 96, h = 28, n = vals.length, mx = Math.max(...vals), mn = Math.min(...vals), rng = mx - mn || 1;
  const pts = vals.map((v, k) => [(k / (n - 1 || 1)) * w, h - 3 - ((v - mn) / rng) * (h - 8)]);
  const d = pts.map((q, k) => (k ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(${colorVar});stop-opacity:.5"/><stop offset="1" style="stop-color:var(${colorVar});stop-opacity:0"/></linearGradient></defs><path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${gid})"/><path d="${d}" style="fill:none;stroke:var(${colorVar})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" style="fill:var(${colorVar})"/></svg>`;
}
function ring(pct, color, label, sub) {
  const r = 26, c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="rt"/><circle cx="32" cy="32" r="${r}" class="rp" transform="rotate(-90 32 32)" style="stroke:${color};stroke-dasharray:${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}"/><text x="32" y="36.5" text-anchor="middle">${pct}%</text></svg><div class="rl" title="${esc(label)}">${esc(label)}</div><div class="rs">${sub}</div></div>`;
}
function heatmapSvg() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let start, end;
  if (F.mode === "year") { start = new Date(+F.year, 0, 1); end = new Date(+F.year, 11, 31); }
  else {
    end = F.mode === "range" && F.to ? new Date(F.to + "T00:00:00") : now;
    start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 364);
    if (F.mode === "range" && F.from) { const f = new Date(F.from + "T00:00:00"); if (f > start) start = f; }
  }
  const spent = {};
  data.transactions.filter((t) => t.type === "expense").forEach((t) => (spent[t.date] = (spent[t.date] || 0) + Number(t.amount)));
  const days = Math.round((end - start) / 864e5) + 1, pad = (start.getDay() + 6) % 7, cols = Math.ceil((pad + days) / 7);
  let mx = 1; for (let k = 0; k < days; k++) mx = Math.max(mx, spent[isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + k))] || 0);
  const cell = 11, gap = 3, top = 14, W = cols * (cell + gap), H = top + 7 * (cell + gap);
  let out = "", lastMonth = -1;
  for (let k = 0; k < days; k++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k), idx = pad + k, col = Math.floor(idx / 7), row = idx % 7;
    if (d > now) continue;
    const key = isoDate(d), v = spent[key] || 0, lvl = v ? Math.ceil((4 * v) / mx) : 0;
    if (row === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) { lastMonth = d.getMonth(); out += `<text x="${col * (cell + gap)}" y="9" class="hm-l">${MONTHS[d.getMonth()]}</text>`; }
    out += `<rect x="${col * (cell + gap)}" y="${top + row * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="hm-c" style="fill:${lvl ? "var(--c2)" : "var(--line)"};opacity:${lvl ? 0.25 + lvl * 0.19 : 1}"><title>${esc(dShort(d))} ${d.getFullYear()}: ${v ? fmt(v) : "no spending"}</title></rect>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Daily spending heatmap">${out}</svg>`;
}

function overview() {
  const tx = data.transactions.filter(inSel);
  const inc = sum(tx.filter((t) => t.type === "income"), (t) => t.amount);
  const exp = sum(tx.filter((t) => t.type === "expense"), (t) => t.amount);
  const net = inc - exp;
  const rate = inc > 0 ? (net / inc) * 100 : 0;
  const prev = hasPrev() ? data.transactions.filter(inPrev) : [];
  const pInc = sum(prev.filter((t) => t.type === "income"), (t) => t.amount);
  const pExp = sum(prev.filter((t) => t.type === "expense"), (t) => t.amount);
  const nw = netWorth();
  const bm = budgetMonth();
  const colors = pal();
  const [k1, k2, k3, k4] = [css("--c1"), css("--c2"), css("--c3"), css("--c4")];

  // sparklines: last 6 months ending at the selected period
  const m6 = lastMonths(6);
  const per = (f) => m6.map((k) => sum(data.transactions.filter((t) => monthKey(t.date) === k && f(t)), (t) => t.amount));
  const sInc = per((t) => t.type === "income"), sExp = per((t) => t.type === "expense"), sNet = sInc.map((v, k) => v - sExp[k]);

  // spending by category
  const byCat = {};
  tx.filter((t) => t.type === "expense").forEach((t) => (byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount)));
  let cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length > 6) cats = [...cats.slice(0, 5), ["Other", cats.slice(5).reduce((s2, c) => s2 + c[1], 0)]];

  // budget limit (stacked by category)
  const totalLimit = sum(data.budgets, (b) => b.limit);
  const totalSpent = sum(data.budgets, (b) => budgetSpent(b.category, bm));
  const limSegs = data.budgets.map((b, k) => { const sp = budgetSpent(b.category, bm); return sp > 0 && totalLimit ? `<span style="width:${(sp / totalLimit) * 100}%;background:${colors[k % 6]}" title="${esc(b.category)}: ${fmt(sp)} of ${fmt(b.limit)}"></span>` : ""; }).join("");
  const limLegend = data.budgets.slice(0, 5).map((b, k) => { const sp = budgetSpent(b.category, bm); return `<span><i class="dot" style="background:${colors[k % 6]}"></i>${esc(b.category)} <b class="${sp > b.limit ? "bad" : ""}">${Math.round((sp / (b.limit || 1)) * 100)}%</b></span>`; }).join("");

  // insights
  const tips = [];
  if (cats.length) tips.push({ ic: "↑", c: k3, h: `<b>${esc(cats[0][0])}</b> is your biggest expense, ${Math.round((cats[0][1] / exp) * 100)}% of spending in this period.` });
  const ob = overBudget();
  tips.push(ob.length ? { ic: "!", c: k2, h: `You're over budget on <b>${esc(ob[0].category)}</b> by ${fmt(ob[0].over)}${ob.length > 1 ? ` and ${ob.length - 1} more` : ""} in ${esc(monthLabel(bm))}.` }
    : data.budgets.length ? { ic: "✓", c: k1, h: `All your budgets are on track for ${esc(monthLabel(bm))}.` } : { ic: "i", c: k4, h: "Set category budgets to get alerts when you overspend." });
  tips.push(inc > 0 ? { ic: "%", c: rate >= 20 ? k1 : k3, h: rate >= 20 ? `You're saving ${rate.toFixed(0)}% of income. That's above the common 20% target.` : `You're saving ${Math.max(0, rate).toFixed(0)}% of income. A common target is 20%.` } : { ic: "i", c: k4, h: "Add income to see your savings rate." });

  // health score
  const bs = data.budgets, okCount = bs.filter((b) => budgetSpent(b.category, bm) <= b.limit).length;
  const score = Math.round(Math.max(0, Math.min(60, (rate / 30) * 60)) + (bs.length ? (40 * okCount) / bs.length : 20));
  const label = score >= 75 ? "Excellent" : score >= 50 ? "Good" : "Needs attention";

  // goals as rings
  const goalsHtml = data.goals.slice(0, 3).map((g, k) => ring(Math.min(100, Math.round((g.saved / (g.target || 1)) * 100)), colors[k % 6], g.name, `${compact(g.saved)} / ${compact(g.target)}`)).join("") || `<p class="muted">No goals yet.</p>`;

  const recent = [...tx].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 7);
  const gross = nw.assets + nw.invested + nw.liabilities || 1;
  const nwSeg = (v, c) => `<span style="width:${(v / gross) * 100}%;background:${c}"></span>`;
  const dailyMonth = balView === "daily" && F.mode === "month";
  const dailyHeat = balView === "daily" && F.mode !== "month";

  $app.innerHTML = `
  <div class="dash">
    <div class="dash-main">
      <section class="card balance">
        <div class="card-head">
          <div><div class="big ${net < 0 ? "bad" : ""}" data-count="${net}">${fmt(net)}</div><div class="eyebrow">Net balance</div></div>
          <div class="tgl" role="tablist"><button data-bal="trend" class="${balView === "trend" ? "on" : ""}">Trend</button><button data-bal="daily" class="${balView === "daily" ? "on" : ""}">Daily</button></div>
          ${balView === "trend" ? `<div class="legend"><span><i class="dot" style="background:var(--c1)"></i>Income</span><span><i class="dot" style="background:var(--c2)"></i>Expenses</span><span><i class="dot" style="background:var(--c4)"></i>Savings</span></div>`
            : `<div class="legend"><span>Daily spending</span><span class="hm-scale"><i></i><i></i><i></i><i></i> more</span></div>`}
        </div>
        ${dailyHeat ? `<div class="heat">${heatmapSvg()}</div>` : `<div class="chart-wrap tall"><canvas id="c1"></canvas></div>`}
      </section>
      <div class="stats">
        <div class="card stat"><div class="eyebrow">Total income</div><div class="val" data-count="${inc}">${fmt(inc)}</div>${chgHtml(inc, pInc, true)}${spark(sInc, "--c1")}</div>
        <div class="card stat"><div class="eyebrow">Total expenses</div><div class="val" data-count="${exp}">${fmt(exp)}</div>${chgHtml(exp, pExp, false)}${spark(sExp, "--c2")}</div>
        <div class="card stat"><div class="eyebrow">Saved balance</div><div class="val ${net < 0 ? "bad" : ""}" data-count="${net}">${fmt(net)}</div>${chgHtml(net, pInc - pExp, true)}${spark(sNet, "--c4")}</div>
      </div>
      <section class="card cost">
        <div class="card-title"><h3>Cost analysis<small>Spending overview</small></h3></div>
        <div class="costwrap">
          <div class="donut"><canvas id="c3"></canvas><div class="dtot"><b>${compact(exp)}</b><small>spent</small></div></div>
          <div class="catlist">${cats.map(([c, v], k) => `<div><span class="nm"><i class="dot" style="background:${colors[k % 6]}"></i>${esc(c)}</span><b>${Math.round((v / (exp || 1)) * 100)}%</b></div>`).join("") || `<span class="muted">No expenses in this period.</span>`}</div>
        </div>
      </section>
      <section class="card health">
        <div class="card-title"><h3>Financial health<small>Savings + budget discipline</small></h3></div>
        <div class="gauge"><canvas id="c2"></canvas><div class="gauge-val">${score}%<small>${label}</small></div></div>
        <p class="muted" style="margin:8px 0 0;font-size:12px">Savings rate ${rate.toFixed(0)}% · ${okCount}/${bs.length} budgets on track</p>
      </section>
      <section class="card goalsc">
        <div class="card-title"><h3>Goal tracker</h3><button class="link" data-go="goals">Add goal</button></div>
        <div class="rings">${goalsHtml}</div>
      </section>
      <section class="card limit">
        <div class="card-title"><h3>Monthly spending limit<small>Across all budgets · ${esc(monthLabel(bm))}</small></h3><button class="link" data-go="budgets">Edit</button></div>
        <div class="limitbar ${totalLimit && totalSpent > totalLimit ? "over" : ""}">${limSegs}</div>
        <div class="row-between"><span><b>${fmt(totalSpent)}</b> spent</span><span>${totalLimit ? fmt(totalLimit) + " limit" : "no budgets set"}</span></div>
        <div class="limleg">${limLegend}</div>
      </section>
      <section class="card tips">
        <div class="card-title"><h3>Insights<small>Based on this period</small></h3><button class="link" data-go="budgets">Budgets</button></div>
        <ul class="tiplist">${tips.map((t) => `<li><span class="ti" style="background:${hexA(t.c, 0.2)};color:${t.c}">${t.ic}</span><span>${t.h}</span></li>`).join("")}</ul>
      </section>
    </div>
    <aside class="dash-side">
      <section class="card walletcard">
        <div class="eyebrow">Net worth</div>
        <div class="big" data-count="${nw.total}">${fmt(nw.total)}</div>
        <div class="nwbar">${nwSeg(nw.assets, "rgba(18,22,10,.75)")}${nwSeg(nw.invested, "rgba(18,22,10,.45)")}${nwSeg(nw.liabilities, "rgba(255,255,255,.7)")}</div>
        <div class="mini"><div><span>Cash &amp; assets</span><b>${fmt(nw.assets)}</b></div><div><span>Invested</span><b>${fmt(nw.invested)}</b></div><div><span>Owed</span><b>${fmt(nw.liabilities)}</b></div></div>
      </section>
      <section class="card hist">
        <div class="card-title"><h3>Transaction history</h3><button class="link" data-go="transactions">View all</button></div>
        <div class="txlist">${recent.map((t) => `<div class="tx">${txIcon(t) || `<div class="avatar" style="background:linear-gradient(135deg,${catColor(t.category)},${lighten(catColor(t.category), 0.45)})">${esc((t.note || t.category).charAt(0).toUpperCase())}</div>`}
          <div><div class="t">${esc(t.note || t.category)}</div><div class="s">${esc(t.date)} · ${esc(t.category)}</div></div>
          <div class="a ${t.type === "income" ? "good" : t.type === "transfer" ? "muted" : ""}">${txAmt(t)}</div></div>`).join("") || `<span class="muted">No transactions in this period.</span>`}</div>
      </section>
      <section class="card">
        <div class="card-title"><h3>Quick actions</h3></div>
        <div class="qa">
          <button data-go="transactions:expense"><b>−</b>Expense</button>
          <button data-go="transactions:income"><b>+</b>Income</button>
          <button data-go="budgets"><b>%</b>Budget</button>
          <button data-go="investments"><b>↗</b>Holding</button>
          <button data-go="networth"><b>▣</b>Asset</button>
          <button data-go="goals"><b>★</b>Goal</button>
        </div>
      </section>
    </aside>
  </div>`;

  const grid = css("--line");
  const axis = { x: { grid: { display: false } }, y: { grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => (Math.abs(v) >= 1000 ? v / 1000 + "k" : v) } } };
  if (dailyMonth) {
    const dim = new Date(+F.month.slice(0, 4), +F.month.slice(5, 7), 0).getDate();
    const day = Array(dim).fill(0);
    tx.filter((t) => t.type === "expense").forEach((t) => (day[+String(t.date).slice(8, 10) - 1] += Number(t.amount) || 0));
    const mx = Math.max(...day, 1);
    chart("c1", { type: "bar", data: { labels: day.map((_, k) => k + 1), datasets: [{ label: "Spent", data: day, backgroundColor: day.map((v) => hexA(k2, 0.25 + 0.75 * (v / mx))), borderRadius: 4 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => `Day ${c[0].label}`, label: (c) => ` Spent: ${fmt(c.parsed.y)}` } } }, scales: axis } });
  } else if (!dailyHeat) {
    const b = bucketize(tx);
    const grad = (col) => (ctx) => { const a = ctx.chart.chartArea; if (!a) return hexA(col, 0.2); const gr = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); gr.addColorStop(0, hexA(col, 0.26)); gr.addColorStop(1, hexA(col, 0)); return gr; };
    const line = (label, d, col, fill) => ({ label, data: d, borderColor: col, backgroundColor: fill ? grad(col) : col, fill, tension: 0.4, borderWidth: 2.5, pointRadius: fill ? 3 : 0, pointHoverRadius: 5, pointBackgroundColor: col, pointBorderColor: "#fff", pointBorderWidth: 1.5, glow: fill });
    chart("c1", { type: "line", data: { labels: b.labels, datasets: [line("Income", b.inc, k1, true), line("Expenses", b.exp, k2, true), { ...line("Savings", b.sav, k4, false), borderDash: [5, 4], borderWidth: 2 }] },
      options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } }, scales: axis } });
  }
  chart("c3", { type: "doughnut", data: { labels: cats.length ? cats.map((c) => c[0]) : ["No spending"], datasets: [{ data: cats.length ? cats.map((c) => c[1]) : [1], backgroundColor: cats.length ? gradBg(colors) : [grid], borderColor: css("--card"), borderWidth: 2 }] },
    options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)}` } } } } });
  chart("c2", { type: "doughnut", data: { datasets: [{ data: [score, 100 - score], borderWidth: 0, glow: true, glowColor: k4,
    backgroundColor: (ctx) => { if (ctx.dataIndex !== 0) return grid; const a = ctx.chart.chartArea; if (!a) return k1; const gr = ctx.chart.ctx.createLinearGradient(a.left, 0, a.right, 0); gr.addColorStop(0, k2); gr.addColorStop(0.5, k3); gr.addColorStop(1, k1); return gr; } }] },
    options: { rotation: -90, circumference: 180, cutout: "78%", plugins: { legend: { display: false }, tooltip: { enabled: false } } } });

  $app.querySelectorAll("[data-go]").forEach((el) => (el.onclick = () => { const [v, arg] = el.dataset.go.split(":"); goTo(v, () => focusForm(arg)); }));
  $app.querySelectorAll("[data-bal]").forEach((el) => (el.onclick = () => { balView = el.dataset.bal; render(); }));
}

function transactions() {
  const all = data.transactions.filter(inSel)
    .filter((t) => (F.type === "all" || t.type === F.type) && (F.cat === "all" || t.category === F.cat))
    .filter((t) => !F.q || `${t.note || ""} ${t.category}`.toLowerCase().includes(F.q))
    .sort((a, b) => b.date.localeCompare(a.date));
  const rows = all.slice(0, 300);
  const xf = data.transactions.filter(inSel).filter((t) => t.type === "transfer");
  const xIn = sum(xf.filter((t) => t.dir === "in"), (t) => t.amount), xOut = sum(xf.filter((t) => t.dir !== "in"), (t) => t.amount);
  const xAcc = {};
  xf.forEach((t) => { const k = t.account || "Unlabelled"; const o = (xAcc[k] = xAcc[k] || { i: 0, o: 0 }); o[t.dir === "in" ? "i" : "o"] += Number(t.amount) || 0; });
  const li = sum(all.filter((t) => t.type === "income"), (t) => t.amount), le = sum(all.filter((t) => t.type === "expense"), (t) => t.amount);
  $app.innerHTML = `
    <div class="card">
      <h2 class="h2row">Add transaction <button type="button" class="ghost sm" id="impBtn">⬆ Import statements</button></h2>
      <form class="inline" id="f">
        <select name="type" id="typeSel"><option>expense</option><option>income</option></select>
        <select name="category" id="catSel">${opts(EXPENSE_CATS)}</select>
        <input name="amount" type="number" min="0" step="0.01" placeholder="Amount (₹)" required>
        <input name="date" type="date" value="${todayStr()}" required>
        <input name="note" placeholder="Note" maxlength="120">
        <button class="primary">Add</button>
      </form>
      <p class="muted">${all.length} entries · Income <b class="good">${fmt(li)}</b> · Expenses <b class="bad">${fmt(le)}</b> · Net <b>${fmt(li - le)}</b> · Transfers ⇄ <b>${fmt(sum(all.filter((t) => t.type === "transfer"), (t) => t.amount))}</b>${all.length > rows.length ? ` · showing latest ${rows.length}` : ""}</p>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${rows.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.type)}</td><td>${esc(t.category)}</td><td>${txIcon(t) ? `<span class="notecell">${txIcon(t)}${esc(t.note)}</span>` : esc(t.note)}${t.account ? ` <span class="acctag">${esc(t.account)}</span>` : ""}</td>
        <td class="num ${txCls(t)}">${txAmt(t)}</td>
        <td><button class="del" data-del="${esc(t.id)}" title="Delete">✕</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No transactions yet.</td></tr>`}</tbody></table></div>
    </div>
    <div class="card xferbox">
      <div class="card-title"><h3>Transfers between my accounts</h3><button type="button" class="ghost sm" id="xferScan">Find transfers in my entries</button></div>
      <p class="muted">Counted separately: not income, not expense, not in savings rate. ${xf.length} entr${xf.length === 1 ? "y" : "ies"} · Moved out <b>${fmt(xOut)}</b> · Moved in <b>${fmt(xIn)}</b> · Net left your accounts <b>${fmt(xOut - xIn)}</b> <span class="sm">(loans, FDs or accounts you haven't imported)</span></p>
      ${xf.length ? `<div class="scroll"><table><thead><tr><th>Account</th><th class="num">Out</th><th class="num">In</th><th class="num">Net</th></tr></thead><tbody>${Object.entries(xAcc).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmt(v.o)}</td><td class="num">${fmt(v.i)}</td><td class="num">${fmt(v.i - v.o)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted sm">None yet. Import statements from several accounts, add your accounts under Net worth (with account numbers / UPI ids), or tap Find transfers.</p>`}
    </div>`;
  document.getElementById("xferScan").onclick = () => window.impScanLedger && window.impScanLedger();
  document.getElementById("impBtn").onclick = () => window.openImport && window.openImport();
  const typeSel = document.getElementById("typeSel");
  typeSel.onchange = () => (document.getElementById("catSel").innerHTML = opts(typeSel.value === "income" ? INCOME_CATS : EXPENSE_CATS));
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("transactions", { type: f.get("type"), category: f.get("category"), amount: Number(f.get("amount")), date: f.get("date"), note: f.get("note") });
  };
  bindDelete("transactions");
}

function budgets() {
  const m = budgetMonth();
  const spent = (cat) => sum(data.transactions.filter((t) => t.type === "expense" && t.category === cat && monthKey(t.date) === m), (t) => t.amount);
  $app.innerHTML = `
    <div class="card">
      <h2>Monthly budgets (${m})</h2>
      <form class="inline" id="f">
        <select name="category">${opts(EXPENSE_CATS)}</select>
        <input name="limit" type="number" min="1" step="1" placeholder="Monthly limit (₹)" required>
        <button class="primary">Add budget</button>
      </form>
      <div class="scroll bgrid">${data.budgets.map((b) => {
        const s = spent(b.category), pct = Math.min(100, Math.round((s / b.limit) * 100));
        return `<div class="budget-row"><div class="head"><span>${esc(b.category)}
          <button class="del" data-del="${esc(b.id)}" title="Delete">✕</button></span>
          <span class="${s > b.limit ? "bad" : ""}">${fmt(s)} / ${fmt(b.limit)}</span></div>
          <div class="bar ${s > b.limit ? "over" : pct >= 80 ? "warn" : ""}"><div style="width:${pct}%"></div></div></div>`;
      }).join("") || `<p class="muted">No budgets yet.</p>`}</div>
    </div>`;
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("budgets", { category: f.get("category"), limit: Number(f.get("limit")) });
  };
  bindDelete("budgets");
}

function investments() {
  const invested = sum(data.investments, (i) => i.invested), current = sum(data.investments, (i) => i.current);
  const gain = current - invested;
  $app.innerHTML = `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Invested</div><div class="value">${fmt(invested)}</div></div>
      <div class="card kpi"><div class="label">Current value</div><div class="value">${fmt(current)}</div></div>
      <div class="card kpi"><div class="label">Gain / loss</div><div class="value ${gain >= 0 ? "good" : "bad"}">${fmt(gain)} (${invested ? ((gain / invested) * 100).toFixed(1) : 0}%)</div></div>
    </div>
    <div class="grid two">
      <div class="card">
        <h2>Holdings</h2>
        <form class="inline" id="f">
          <input name="name" placeholder="Name" required maxlength="60">
          <select name="type">${opts(INV_TYPES)}</select>
          <input name="invested" type="number" min="0" step="0.01" placeholder="Invested (₹)" required>
          <input name="current" type="number" min="0" step="0.01" placeholder="Current (₹)" required>
          <button class="primary">Add</button>
        </form>
        <div class="scroll"><table><thead><tr><th>Name</th><th>Type</th><th class="num">Invested</th><th class="num">Current</th><th class="num">P/L</th><th></th></tr></thead>
        <tbody>${data.investments.map((i) => { const g = i.current - i.invested; return `<tr><td>${esc(i.name)}</td><td>${esc(i.type)}</td>
          <td class="num">${fmt(i.invested)}</td><td class="num">${fmt(i.current)}</td><td class="num ${g >= 0 ? "good" : "bad"}">${fmt(g)}</td>
          <td><button class="del" data-del="${esc(i.id)}" title="Delete">✕</button></td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">No holdings yet.</td></tr>`}</tbody></table></div>
      </div>
      <div class="card"><h2>Allocation by type</h2><div class="chart-wrap"><canvas id="c1"></canvas></div></div>
    </div>`;
  const byType = {};
  data.investments.forEach((i) => (byType[i.type] = (byType[i.type] || 0) + Number(i.current)));
  chart("c1", { type: "doughnut", data: { labels: Object.keys(byType), datasets: [{ data: Object.values(byType), backgroundColor: gradBg(pal()), borderColor: css("--card"), borderWidth: 3 }] },
    options: { cutout: "68%", plugins: { legend: { position: "right", labels: { usePointStyle: true, boxWidth: 8 } } } } });
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("investments", { name: f.get("name"), type: f.get("type"), invested: Number(f.get("invested")), current: Number(f.get("current")) });
  };
  bindDelete("investments");
}

let selCard = null;
const CARD_GRADS = [["#4a5fc1", "#7b6fd0"], ["#b9536c", "#d4876a"], ["#2f7fa3", "#4a78c8"], ["#2c8a76", "#4aae9b"], ["#b0823a", "#b95f7c"]];
function nextDue(day) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const at = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  let d = at(t.getFullYear(), t.getMonth());
  if (d < t) d = at(t.getFullYear(), t.getMonth() + 1);
  return { date: d, days: Math.round((d - t) / 864e5) };
}
const utilClass = (u) => (u > 70 ? "bad" : u > 30 ? "warn" : "good");


/* ---- Bank / card-network icons (generic glyphs, optional custom upload) ---- */
const BANK_GLYPH = '<path d="M3 9.5L12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
const CARD_GLYPH = '<rect x="3" y="6" width="18" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10.5h18" stroke="currentColor" stroke-width="2"/><path d="M6.5 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
const LOAN_GLYPH = '<path d="M12 4v16M16.5 8c0-1.7-2-2.5-4.5-2.5S7.5 6.6 7.5 8.4 9.5 11 12 11.4s4.5 1.1 4.5 3-2 2.8-4.5 2.8-4.5-.9-4.5-2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
const NET_COL = { Visa: "#7aa2f7", Mastercard: "#f08a6a", RuPay: "#6fcf97", Coral: "#f08aa6", Amex: "#6cc3e0", Diners: "#a78bfa", Other: "#9aa8c4" };
const hashCol = (str) => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 55% 65%)`; };
function glyphTile(key, name, glyph, col) {
  const custom = subIcons[String(key).toLowerCase()];
  if (custom) return `<span class="subico custom" style="background-image:url(${custom})" title="${esc(name)}"></span>`;
  return `<span class="subico" style="--ic:${col}" title="${esc(name)}"><svg viewBox="0 0 24 24" width="20" height="20">${glyph}</svg>${logoImg(String(key).replace(/^(bank|acct):/, ""))}</span>`;
}
const bankIcon = (name) => glyphTile("bank:" + name, name, BANK_GLYPH, hashCol(String(name).split(/\s+/)[0]));
const netChip = (net) => `<span class="netchip" style="--ic:${NET_COL[net] || NET_COL.Other}"><svg viewBox="0 0 24 24" width="14" height="14">${CARD_GLYPH}</svg>${logoImg("net-" + net)}${esc(net)}</span>`;
function acctIcon(a) {
  const n = String(a.name).toLowerCase();
  if (a.kind === "liability" || /loan|emi|mortgage/.test(n)) return glyphTile("acct:" + a.name, a.name, LOAN_GLYPH, "#e0707f");
  return glyphTile("acct:" + a.name, a.name, BANK_GLYPH, a.kind === "bank account" ? "#6cc3e0" : /fd|deposit|emergency/.test(n) ? "#f0b36a" : "#6fcf97");
}

function cardTile(c, k) {
  const [g1, g2] = CARD_GRADS[k % CARD_GRADS.length];
  const util = c.limit ? Math.min(100, Math.round((c.outstanding / c.limit) * 100)) : 0;
  return `<button class="ccard${selCard === c.id ? " sel" : ""}" data-card="${esc(c.id)}" style="--g1:${g1};--g2:${g2}">
    <div class="cc-top"><span class="cc-name">${bankIcon(c.name)}<span>${esc(c.name)}</span></span>${netChip(c.network)}</div>
    <div class="cc-num">•••• •••• •••• ${esc(c.last4)}</div>
    <div class="cc-row"><div><small>Outstanding</small><b>${fmt(c.outstanding)}</b></div><div><small>Limit</small><b>${fmt(c.limit)}</b></div></div>
    <div class="cc-util"><div style="width:${util}%"></div></div>
    <div class="cc-foot"><span>${util}% used</span><span>Due ${nextDue(c.dueDay).date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></div>
  </button>`;
}
function cardDetail(c) {
  const util = c.limit ? (c.outstanding / c.limit) * 100 : 0;
  const due = nextDue(c.dueDay);
  return `<div class="card ccdetail">
    <div class="card-title"><h3 class="cc-h"><label class="icopick" title="Click to use your own bank icon">${bankIcon(c.name)}<input type="file" accept="image/*" data-ico="${esc("bank:" + c.name.toLowerCase())}" hidden></label>${esc(c.name)} <small>${netChip(c.network)} •••• ${esc(c.last4)}</small>${subIcons["bank:" + c.name.toLowerCase()] ? ` <a href="#" class="link" data-icoreset="${esc("bank:" + c.name.toLowerCase())}">reset</a>` : ""}</h3><button class="del" data-closecard title="Close details" aria-label="Close details">✕</button></div>
    <div class="ccgrid">
      <div><div class="eyebrow">Outstanding</div><b class="bad">${fmt(c.outstanding)}</b></div>
      <div><div class="eyebrow">Available credit</div><b class="good">${fmt(Math.max(0, c.limit - c.outstanding))}</b></div>
      <div><div class="eyebrow">Utilization</div><b class="${utilClass(util)}">${util.toFixed(0)}%</b></div>
      <div><div class="eyebrow">Next due</div><b>${due.date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</b><small class="muted"> in ${due.days} day${due.days === 1 ? "" : "s"}</small></div>
    </div>
    <div class="bar ${util > 70 ? "over" : ""}" style="margin:10px 0 14px"><div style="width:${Math.min(100, util)}%"></div></div>
    <div class="ccforms">
      <form class="cc-pay" data-id="${esc(c.id)}"><input name="amt" type="number" min="1" step="1" placeholder="Payment (₹)" required><button class="primary">Record payment</button></form>
      <form class="cc-spend" data-id="${esc(c.id)}"><input name="amt" type="number" min="1" step="1" placeholder="New spend (₹)" required><button class="ghost">Add spend</button></form>
      <button class="ghost sm danger" data-delcard="${esc(c.id)}">Remove card</button>
    </div>
    ${util > 30 ? `<p class="muted" style="margin:12px 0 0;font-size:12px">Keeping utilization under 30% is generally better for your credit score.</p>` : ""}
  </div>`;
}

function networthView() {
  const nw = netWorth();
  const other = nw.liabilities - nw.cardDues;
  const cur = data.cards.find((c) => c.id === selCard);
  if (!cur) selCard = null;
  $app.innerHTML = `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Cash & other assets</div><div class="value">${fmt(nw.assets)}</div></div>
      <div class="card kpi"><div class="label">Investments</div><div class="value">${fmt(nw.invested)}</div></div>
      <div class="card kpi"><div class="label">Loans & other dues</div><div class="value bad">${fmt(other)}</div></div>
      <div class="card kpi"><div class="label">Credit card dues</div><div class="value bad">${fmt(nw.cardDues)}</div></div>
      <div class="card kpi"><div class="label">Net worth</div><div class="value">${fmt(nw.total)}</div></div>
    </div>
    <div class="grid two nwgrid">
      <div class="card">
        <h2>Assets & liabilities</h2>
        <form class="inline" id="f">
          <input name="name" placeholder="Name" required maxlength="60">
          <select name="kind"><option value="bank account">Bank account</option><option value="asset">Other asset</option><option value="liability">Liability</option></select>
          <select name="role" title="What this account is used for"><option value="">Role (optional)</option>${ACCT_ROLES.map((r) => `<option>${r}</option>`).join("")}</select>
          <input name="match" placeholder="Identifiers: a/c no., UPI id, name (comma separated)" maxlength="120" title="Used to recognise transfers in imported statements">
          <input name="value" type="number" min="0" step="0.01" placeholder="Value (₹)" required>
          <button class="primary">Add</button>
        </form>
        <div class="scroll"><table><thead><tr><th>Name</th><th>Kind</th><th class="num">Value</th><th></th></tr></thead>
        <tbody>${data.accounts.map((a) => `<tr><td><div class="subname"><label class="icopick" title="Click to use your own icon">${acctIcon(a)}<input type="file" accept="image/*" data-ico="${esc("acct:" + a.name.toLowerCase())}" hidden></label><span>${esc(a.name)}${subIcons["acct:" + a.name.toLowerCase()] ? ` <a href="#" class="link" data-icoreset="${esc("acct:" + a.name.toLowerCase())}">reset</a>` : ""}</span></div></td><td><span class="pill ${a.kind === "liability" ? "bad" : a.kind === "bank account" ? "ok" : ""}">${a.kind === "bank account" ? "Bank account" : a.kind === "asset" ? "Other asset" : "Liability"}</span>${a.role ? ` <span class="muted sm">${esc(a.role)}</span>` : ""}${a.match ? `<div class="muted sm" title="Used to recognise transfers in statements">🔗 ${esc(a.match)}</div>` : ""}</td>
          <td class="num ${a.kind === "liability" ? "bad" : ""}">${fmt(a.value)}</td>
          <td><button class="del" data-del="${esc(a.id)}" title="Delete">✕</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nothing added yet.</td></tr>`}</tbody></table></div>
        <div class="chart-wrap" style="margin-top:18px"><canvas id="c1"></canvas></div>
      </div>
      <div class="card cccol">
        <h2>Credit cards</h2>
        <details class="addcard"${data.cards.length ? "" : " open"}><summary>+ Add credit card</summary>
          <form class="inline" id="cardForm">
            <input name="name" placeholder="Card name (e.g. HDFC Regalia)" required maxlength="40">
            <input name="last4" placeholder="Last 4 digits" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required>
            <select name="network"><option>Visa</option><option>Mastercard</option><option>RuPay</option><option>Coral</option><option>Amex</option><option>Diners</option><option>Other</option></select>
            <input name="limit" type="number" min="1" step="1" placeholder="Credit limit (₹)" required>
            <input name="outstanding" type="number" min="0" step="0.01" placeholder="Outstanding (₹)" value="0" required>
            <input name="dueDay" type="number" min="1" max="31" placeholder="Due day (1-31)" required>
            <button class="primary">Add card</button>
          </form>
          <p class="muted" style="font-size:12px;margin:0 0 12px">Only the last 4 digits are stored. Never enter a full card number.</p>
        </details>
        <div class="scroll ccscroll">
        <div class="cclist">${data.cards.map(cardTile).join("") || `<p class="muted">No credit cards yet.</p>`}</div>
        ${cur ? cardDetail(cur) : data.cards.length ? `<p class="muted" style="margin:12px 0 0;font-size:12px">Click a card to see details and record payments.</p>` : ""}
        </div>
      </div>
    </div>`;
  chart("c1", { type: "bar", data: { labels: ["Cash & assets", "Investments", "Liabilities (incl. cards)"],
    datasets: [{ data: [nw.assets, nw.invested, nw.liabilities], backgroundColor: gradBg([css("--c1"), css("--c4"), css("--c2")]), borderRadius: 10, borderSkipped: false }] },
    options: { plugins: { legend: { display: false } } } });
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("accounts", { name: f.get("name"), kind: f.get("kind"), role: f.get("role") || "", match: String(f.get("match") || "").trim(), value: Number(f.get("value")) });
  };
  document.getElementById("cardForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("cards", { name: f.get("name"), last4: String(f.get("last4")).replace(/\D/g, "").slice(0, 4), network: f.get("network"),
      limit: Number(f.get("limit")), outstanding: Number(f.get("outstanding")), dueDay: Math.min(31, Math.max(1, Number(f.get("dueDay")))) });
  };
  $app.querySelectorAll("[data-card]").forEach((b) => (b.onclick = () => { selCard = selCard === b.dataset.card ? null : b.dataset.card; render(); const d = $app.querySelector(".ccdetail"); if (d) d.scrollIntoView({ block: "nearest", behavior: "smooth" }); }));
  const closeBtn = $app.querySelector("[data-closecard]");
  if (closeBtn) closeBtn.onclick = () => { selCard = null; render(); };
  const delBtn0 = $app.querySelector("[data-delcard]");
  if (delBtn0 && !$app.querySelector("[data-editcard]")) { const e = document.createElement("button"); e.className = "ghost sm"; e.dataset.editcard = delBtn0.dataset.delcard; e.textContent = "Edit card"; e.onclick = () => openEdit("cards", e.dataset.editcard); delBtn0.before(e); }
  const delBtn = $app.querySelector("[data-delcard]");
  if (delBtn) delBtn.onclick = () => { if (confirm("Remove this card?")) { const id = delBtn.dataset.delcard; selCard = null; remove("cards", id); } };
  const adjust = (sel, sign) => $app.querySelectorAll(sel).forEach((fm) => (fm.onsubmit = async (e) => {
    e.preventDefault();
    const c = data.cards.find((x) => x.id === fm.dataset.id);
    if (c) await update("cards", c.id, { outstanding: Math.max(0, Number(c.outstanding) + sign * Number(new FormData(fm).get("amt"))) });
  }));
  adjust("form.cc-pay", -1); adjust("form.cc-spend", +1);
  $app.querySelectorAll("[data-ico]").forEach((i) => (i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    try { subIcons[i.dataset.ico] = await resizeIcon(f); saveSubIcons(); render(); } catch {}
  }));
  $app.querySelectorAll("[data-icoreset]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); delete subIcons[a.dataset.icoreset]; saveSubIcons(); render(); }));
  bindDelete("accounts");
}

const SUB_CATS = ["OTT", "Apple", "Google One", "Music", "Cloud", "Software", "News", "Other"];
const subMatch = (sub, t) => t.type === "expense" && t.category === "Subscriptions" && String(t.note || "").toLowerCase().includes(String(sub.name).toLowerCase());
const subMonthly = (x) => (x.cycle === "yearly" ? x.amount / 12 : x.amount);
const dayClamp = (y, m, d) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()));
const midnight = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
function subNext(x) {
  const t = midnight();
  if (x.cycle === "yearly") { const m = (x.month || 1) - 1; let d = dayClamp(t.getFullYear(), m, x.day); if (d < t) d = dayClamp(t.getFullYear() + 1, m, x.day); return d; }
  let d = dayClamp(t.getFullYear(), t.getMonth(), x.day); if (d < t) d = dayClamp(t.getFullYear(), t.getMonth() + 1, x.day); return d;
}
const subDueThisMonth = (x) => x.cycle !== "yearly" || Number(x.month) === new Date().getMonth() + 1;
const subBillDate = (x) => dayClamp(new Date().getFullYear(), new Date().getMonth(), x.day);
const dShort = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });



/* ---- Logo files: drop images into the icons/ folder, named after the item ---- */
const slug = (x) => String(x || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const LOGO_ALIAS = { sbi: "state-bank-of-india", pnb: "punjab-national-bank", bob: "bank-of-baroda", boi: "bank-of-india", "net-rupay": "rupay", "net-coral": "coral" };
function logoCands(name) {
  let full = slug(name).replace(/^net-/, "");
  full = LOGO_ALIAS[full] || full;
  const first0 = full.split("-")[0], first = LOGO_ALIAS[first0] || first0;
  const IDX = window.ICON_INDEX || {}, keys = Object.keys(IDX);
  const pre = (p) => keys.filter((k) => k.startsWith(p + "-")).sort((a, b) => a.length - b.length)[0];
  const out = [];
  [full, first].forEach((b, i) => { if (b) { out.push(`icons/${b}.svg`, `icons/${b}.png`); } });
  [full, pre(full), first, pre(first)].forEach((k) => { if (k && IDX[k]) out.push(IDX[k]); });
  [full, first].forEach((k) => { const c = (window.ICON_CRYPTO || {})[k]; if (c) out.push(c); });
  return [...new Set(out)];
}
const logoImg = (name) => !logoCands(name).length ? "" : `<img class="logo" alt="" data-c="${esc(logoCands(name).join(","))}" data-i="0" src="${esc(logoCands(name)[0] || "")}">`;
document.addEventListener("error", (e) => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || !im.classList.contains("logo")) return;
  const list = im.dataset.c.split(","), n = Number(im.dataset.i) + 1;
  if (n < list.length) { im.dataset.i = n; im.src = list[n]; } else im.remove();
}, true);

/* ---- Subscription icons: category glyphs + optional user-uploaded icon ---- */
const SUBICON_KEY = "smartfintrack-subicons";
const subIcons = (() => { try { return JSON.parse(localStorage.getItem(SUBICON_KEY) || "{}"); } catch { return {}; } })();
const saveSubIcons = () => { try { localStorage.setItem(SUBICON_KEY, JSON.stringify(subIcons)); } catch {} };
const SUB_GLYPH = {
  OTT: ['<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>', "#e0707f"],
  Music: ['<path d="M9 17V6l10-2v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="17" r="2.6" fill="currentColor"/><circle cx="17" cy="15" r="2.6" fill="currentColor"/>', "#6fcf97"],
  Apple: ['<path d="M7 18a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17.4 9 3.8 3.8 0 0 1 17 18z" fill="currentColor"/>', "#9aa8c4"],
  "Google One": ['<path d="M7 18a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17.4 9 3.8 3.8 0 0 1 17 18z" fill="currentColor"/>', "#7aa2f7"],
  Cloud: ['<path d="M7 18a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17.4 9 3.8 3.8 0 0 1 17 18z" fill="currentColor"/>', "#6cc3e0"],
  Software: ['<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', "#a78bfa"],
  News: ['<path d="M5 5h11v14H7a2 2 0 0 1-2-2zM16 9h3v8a2 2 0 0 1-2 2M8 9h5M8 12h5M8 15h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>', "#f0b36a"],
  Other: ['<path d="M4 12.5V5h7.5l8 8-7.5 7.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="8.5" cy="9" r="1.4" fill="currentColor"/>', "#c4a0e8"],
};
function subIconFor(name, category) {
  const key = String(name || "").toLowerCase();
  const custom = subIcons[key];
  if (custom) return `<span class="subico custom" style="background-image:url(${custom})" title="${esc(name)}"></span>`;
  const [g, col] = SUB_GLYPH[category] || SUB_GLYPH.Other;
  return `<span class="subico" style="--ic:${col}" title="${esc(name)}"><svg viewBox="0 0 24 24" width="20" height="20">${g}</svg>${logoImg(name)}</span>`;
}
// icon for a ledger transaction: matches a known subscription by name
function txIcon(t) {
  if (t.category !== "Subscriptions") return null;
  const sub = data.subs.find((x) => subMatch(x, t));
  return subIconFor(t.note, sub ? sub.category : "Other");
}
function resizeIcon(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload = () => { const im = new Image(); im.onerror = rej; im.onload = () => {
      const c = document.createElement("canvas"), S = 96; c.width = c.height = S;
      const x = c.getContext("2d"), k = Math.max(S / im.width, S / im.height);
      x.drawImage(im, (S - im.width * k) / 2, (S - im.height * k) / 2, im.width * k, im.height * k);
      res(c.toDataURL("image/png")); }; im.src = r.result; };
    r.readAsDataURL(file);
  });
}

function subsView() {
  const m = thisMonth(), today = midnight();
  const active = data.subs.filter((x) => x.active !== false);
  const monthly = sum(active, subMonthly);
  const dueNow = active.filter(subDueThisMonth);
  const paidTx = data.transactions.filter((t) => t.type === "expense" && t.category === "Subscriptions" && monthKey(t.date) === m);
  const expected = sum(dueNow, (x) => x.amount), paid = sum(paidTx, (t) => t.amount);
  const isPaid = (x) => paidTx.some((t) => subMatch(x, t));
  const unpaidDue = dueNow.filter((x) => !isPaid(x) && subBillDate(x) <= today);

  const rows = [...data.subs].sort((a, b) => subNext(a) - subNext(b)).map((x) => {
    const all = data.transactions.filter((t) => subMatch(x, t));
    const total = sum(all, (t) => t.amount);
    let st = `<span class="muted">—</span>`;
    if (x.active === false) st = `<span class="pill">Paused</span>`;
    else if (isPaid(x)) st = `<span class="pill ok">Paid</span>`;
    else if (subDueThisMonth(x)) st = subBillDate(x) <= today ? `<span class="pill bad">Unpaid</span>` : `<span class="pill">Due ${dShort(subBillDate(x))}</span>`;
    return `<tr class="${x.active === false ? "dim" : ""}">
      <td><div class="subname"><label class="icopick" title="Click to use your own icon">${subIconFor(x.name, x.category)}<input type="file" accept="image/*" data-ico="${esc(x.name.toLowerCase())}" hidden></label><div><b>${esc(x.name)}</b><div class="muted sm">${esc(x.category)}${subIcons[x.name.toLowerCase()] ? ` · <a href="#" class="link" data-icoreset="${esc(x.name.toLowerCase())}">reset</a>` : ""}</div></div></div></td>
      <td class="num">${fmt(x.amount)}<div class="muted sm">${x.cycle === "yearly" ? "per year" : "per month"}</div></td>
      <td>${x.active === false ? "—" : dShort(subNext(x))}</td>
      <td>${st}</td>
      <td class="num">${fmt(total)}<div class="muted sm">${all.length} payment${all.length === 1 ? "" : "s"}</div></td>
      <td class="acts"><button class="ghost sm" data-pay="${esc(x.id)}" ${x.active === false ? "disabled" : ""}>Mark paid</button>
        <button class="ghost sm" data-pause="${esc(x.id)}">${x.active === false ? "Resume" : "Pause"}</button>
        <button class="del" data-del="${esc(x.id)}" title="Delete">✕</button></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No subscriptions yet.</td></tr>`;

  const up = active.map((x) => ({ x, d: subNext(x) })).sort((a, b) => a.d - b.d).slice(0, 10);
  const upHtml = up.map(({ x, d }) => { const n = Math.round((d - today) / 864e5);
    return `<div class="tx">${subIconFor(x.name, x.category)}
      <div><div class="t">${esc(x.name)}</div><div class="s">${dShort(d)} · in ${n} day${n === 1 ? "" : "s"}</div></div><div class="a">${fmt(x.amount)}</div></div>`; }).join("") || `<span class="muted">No active subscriptions.</span>`;

  $app.innerHTML = `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Monthly cost</div><div class="value">${fmt(monthly)}</div></div>
      <div class="card kpi"><div class="label">Yearly cost</div><div class="value">${fmt(monthly * 12)}</div></div>
      <div class="card kpi"><div class="label">Active subscriptions</div><div class="value">${active.length}</div></div>
      <div class="card kpi"><div class="label">Paid this month</div><div class="value ${paid >= expected && expected ? "good" : ""}">${fmt(paid)} <small class="muted">/ ${fmt(expected)}</small></div></div>
      <div class="card kpi"><div class="label">Not yet recorded</div><div class="value ${unpaidDue.length ? "bad" : "good"}">${unpaidDue.length}</div></div>
    </div>
    <div class="grid two subgrid">
      <div class="card">
        <h2>Subscriptions</h2>
        <form class="inline" id="f">
          <input name="name" placeholder="Name (e.g. Netflix)" required maxlength="40">
          <select name="category">${opts(SUB_CATS)}</select>
          <input name="amount" type="number" min="1" step="0.01" placeholder="Amount (₹)" required>
          <select name="cycle"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select>
          <input name="day" type="number" min="1" max="31" placeholder="Day 1-31" title="Billing day of month" required>
          <input name="month" type="number" min="1" max="12" placeholder="Mo. 1-12" title="Billing month (yearly plans only)">
          <button class="primary">Add</button>
        </form>
        <div class="subbar">${unpaidDue.length
          ? `<span><b>${unpaidDue.length}</b> due subscription${unpaidDue.length === 1 ? "" : "s"} (${fmt(sum(unpaidDue, (x) => x.amount))}) not in your ledger yet</span><button class="primary" id="postDue">Record in ledger</button>`
          : `<span class="good">✓ All due subscriptions for ${esc(monthLabel(m))} are recorded in your ledger</span>`}</div>
        <div class="scroll"><table><thead><tr><th>Name</th><th class="num">Amount</th><th>Next bill</th><th>This month</th><th class="num">Paid so far</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div class="card subright">
        <h2>Subscription spend in your ledger</h2>
        <div class="chart-wrap"><canvas id="c1"></canvas></div>
        <h2 style="margin-top:12px">Upcoming renewals</h2>
        <div class="scroll"><div class="txlist">${upHtml}</div></div>
      </div>
    </div>`;

  // last 6 months of subscription payments recorded in the ledger
  const labels = [], keys = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1); keys.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`); labels.push(`${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`); }
  const vals = keys.map((k) => sum(data.transactions.filter((t) => t.type === "expense" && t.category === "Subscriptions" && monthKey(t.date) === k), (t) => t.amount));
  chart("c1", { type: "bar", data: { labels, datasets: [{ label: "Paid", data: vals, backgroundColor: gradBg(css("--c3")), borderRadius: 9, borderSkipped: false }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } } });

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), yearly = f.get("cycle") === "yearly";
    await add("subs", { name: f.get("name").trim(), category: f.get("category"), amount: Number(f.get("amount")), cycle: f.get("cycle"),
      day: Math.min(31, Math.max(1, Number(f.get("day")))), month: yearly ? Math.min(12, Math.max(1, Number(f.get("month")) || 1)) : null, active: true });
  };
  const post = (x, date) => add("transactions", { type: "expense", category: "Subscriptions", amount: x.amount, date: isoDate(date), note: x.name });
  const pd = document.getElementById("postDue");
  if (pd) pd.onclick = async () => { for (const x of unpaidDue) await post(x, subBillDate(x)); };
  $app.querySelectorAll("[data-pay]").forEach((b) => (b.onclick = () => { const x = data.subs.find((r) => r.id === b.dataset.pay); if (x) post(x, new Date()); }));
  $app.querySelectorAll("[data-pause]").forEach((b) => (b.onclick = () => { const x = data.subs.find((r) => r.id === b.dataset.pause); if (x) update("subs", x.id, { active: x.active === false }); }));
  $app.querySelectorAll("[data-ico]").forEach((i) => (i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    try { subIcons[i.dataset.ico] = await resizeIcon(f); saveSubIcons(); render(); } catch {}
  }));
  $app.querySelectorAll("[data-icoreset]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); delete subIcons[a.dataset.icoreset]; saveSubIcons(); render(); }));
  bindDelete("subs");
}

function goalsView() {
  $app.innerHTML = `
    <div class="card">
      <h2>Add goal</h2>
      <form class="inline" id="f">
        <input name="name" placeholder="Goal name" required maxlength="60">
        <input name="target" type="number" min="1" step="1" placeholder="Target (₹)" required>
        <input name="saved" type="number" min="0" step="1" placeholder="Saved so far (₹)" value="0">
        <button class="primary">Add goal</button>
      </form>
      <div class="scroll bgrid">${data.goals.map((g) => {
        const pct = Math.min(100, Math.round((g.saved / (g.target || 1)) * 100));
        return `<div class="budget-row"><div class="head"><span>${esc(g.name)} <button class="del" data-del="${esc(g.id)}" title="Delete">✕</button></span>
          <span>${fmt(g.saved)} / ${fmt(g.target)} · ${pct}%</span></div>
          <div class="bar"><div style="width:${pct}%"></div></div>
          <form class="contrib" data-id="${esc(g.id)}"><input name="amt" type="number" min="1" step="1" placeholder="Add ₹" required><button class="ghost">Add savings</button></form></div>`;
      }).join("") || `<p class="muted">No goals yet. Add one above.</p>`}</div>
    </div>`;
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("goals", { name: f.get("name"), target: Number(f.get("target")), saved: Number(f.get("saved")) || 0 });
  };
  $app.querySelectorAll("form.contrib").forEach((fm) => (fm.onsubmit = async (e) => {
    e.preventDefault();
    const g = data.goals.find((x) => x.id === fm.dataset.id);
    if (g) await update("goals", g.id, { saved: Number(g.saved) + Number(new FormData(fm).get("amt")) });
  }));
  bindDelete("goals");
}


// ---------- edit dialog (every item in every section) ----------
const NETS = ["Visa", "Mastercard", "RuPay", "Coral", "Amex", "Diners", "Other"];
const ALL_CATS = [...new Set([...INCOME_CATS, ...EXPENSE_CATS, ...XFER_CATS])];
const EDIT_SCHEMA = {
  transactions: [["type", "Type", "select", ["expense", "income", "transfer"]], ["dir", "Direction (transfers)", "select", [["out", "Money out"], ["in", "Money in"]]], ["category", "Category", "select", ALL_CATS], ["amount", "Amount (₹)", "number"], ["date", "Date", "date"], ["note", "Note", "text"], ["account", "Account / statement label", "text"]],
  budgets: [["category", "Category", "select", EXPENSE_CATS], ["limit", "Monthly limit (₹)", "number"]],
  investments: [["name", "Name", "text"], ["type", "Type", "select", INV_TYPES], ["invested", "Invested (₹)", "number"], ["current", "Current value (₹)", "number"]],
  accounts: [["name", "Name", "text"], ["kind", "Type", "select", [["bank account", "Bank account"], ["asset", "Other asset"], ["liability", "Liability"]]], ["role", "Role", "select", ["", ...ACCT_ROLES]], ["match", "Identifiers (account no., UPI id, name; comma separated)", "text"], ["value", "Value (₹)", "number"]],
  goals: [["name", "Goal name", "text"], ["target", "Target (₹)", "number"], ["saved", "Saved so far (₹)", "number"]],
  cards: [["name", "Card name", "text"], ["last4", "Last 4 digits", "text"], ["network", "Network", "select", NETS], ["limit", "Credit limit (₹)", "number"], ["outstanding", "Outstanding (₹)", "number"], ["dueDay", "Due day (1-31)", "number"]],
  subs: [["name", "Name", "text"], ["category", "Category", "select", SUB_CATS], ["amount", "Amount (₹)", "number"], ["cycle", "Billing cycle", "select", [["monthly", "Monthly"], ["yearly", "Yearly"]]], ["day", "Billing day (1-31)", "number"], ["month", "Billing month (yearly, 1-12)", "number"]],
};
function openEdit(col, id) {
  const item = data[col].find((r) => r.id === id), schema = EDIT_SCHEMA[col];
  if (!item || !schema) return;
  document.getElementById("editModal")?.remove();
  const field = ([k, label, type, o]) => {
    const v = item[k] ?? "";
    if (type === "select") {
      const list = (o || []).map((x) => (Array.isArray(x) ? x : [x, x]));
      if (v !== "" && !list.some(([val]) => val === v)) list.push([v, v]);
      return `<label>${esc(label)}<select name="${k}">${list.map(([val, t]) => `<option value="${esc(val)}"${val === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    }
    return `<label>${esc(label)}<input name="${k}" type="${type}" value="${esc(v)}"${type === "number" ? ' step="0.01" min="0"' : ""}${k === "name" ? " required" : ""}></label>`;
  };
  const m = document.createElement("div");
  m.id = "editModal"; m.className = "modal";
  m.innerHTML = `<form class="modal-box card"><div class="card-title"><h3>Edit ${esc(item.name || item.category || item.note || "item")}</h3><button type="button" class="del" data-x title="Close">✕</button></div>
    <div class="modal-grid">${schema.map(field).join("")}</div>
    <div class="modal-acts"><button type="button" class="ghost" data-x>Cancel</button><button class="primary">Save changes</button></div></form>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  m.addEventListener("mousedown", (e) => { if (e.target === m) close(); });
  m.querySelectorAll("[data-x]").forEach((b) => (b.onclick = close));
  const form = m.querySelector("form");
  if (col === "transactions") { // keep category list matched to type
    const t = form.elements.type, c = form.elements.category, dr = form.elements.dir;
    const syncDir = () => { dr.closest("label").style.display = t.value === "transfer" ? "" : "none"; };
    if (!item.dir) dr.value = item.type === "income" ? "in" : "out";
    t.addEventListener("change", syncDir); syncDir();
    t.onchange = () => { const cats = t.value === "income" ? INCOME_CATS : t.value === "transfer" ? XFER_CATS : EXPENSE_CATS; const cur = c.value;
      c.innerHTML = cats.map((x) => `<option${x === cur ? " selected" : ""}>${esc(x)}</option>`).join(""); };
    t.onchange(); if (![...c.options].some((o) => o.value === item.category)) c.value = c.options[0].value;
    c.value = [...c.options].some((o) => o.value === item.category) ? item.category : c.value;
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form), patch = {};
    for (const [k, , type] of schema) {
      let v = f.get(k);
      if (type === "number") v = v === "" ? null : Number(v);
      else if (typeof v === "string") v = v.trim();
      patch[k] = v;
    }
    if (col === "transactions") patch.dir = patch.type === "income" ? "in" : patch.type === "expense" ? "out" : patch.dir || "out";
    if (col === "cards") patch.last4 = String(patch.last4 || "").replace(/\D/g, "").slice(0, 4);
    if (col === "subs") { patch.day = Math.min(31, Math.max(1, patch.day || 1)); patch.month = patch.cycle === "yearly" ? Math.min(12, Math.max(1, patch.month || 1)) : null; }
    if (col === "cards") patch.dueDay = Math.min(31, Math.max(1, patch.dueDay || 1));
    close();
    await update(col, id, patch);
  };
  form.querySelector("input,select").focus();
}
function bindDelete(col) {
  $app.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => remove(col, b.dataset.del);
    if (!b.previousElementSibling?.matches?.("[data-edit]")) {
      const e = document.createElement("button");
      e.className = "del edit"; e.dataset.edit = b.dataset.del; e.title = "Edit"; e.setAttribute("aria-label", "Edit"); e.textContent = "✎";
      b.before(e);
    }
  });
  $app.querySelectorAll("[data-edit]").forEach((e) => (e.onclick = () => openEdit(col, e.dataset.edit)));
}

// ---------- shell ----------
function countUp() {
  const els = [...$app.querySelectorAll("[data-count]")];
  if (!els.length || !window.requestAnimationFrame) return;
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    els.forEach((el) => { if (el.isConnected) el.textContent = fmt(Number(el.dataset.count) * e); });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const THEME_KEY = "smartfintrack-theme";
function effectiveTheme() { return document.documentElement.dataset.theme || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
try { const t = localStorage.getItem(THEME_KEY); if (t === "dark" || t === "light") document.documentElement.dataset.theme = t; } catch {}

const views = { overview, transactions, budgets, investments, networth: networthView, goals: goalsView, subs: subsView };
const TITLES = { overview: "Dashboard", transactions: "Ledger", budgets: "Budgets", investments: "Investments", networth: "Net worth", goals: "Goals", subs: "Subscriptions" };

function goTo(v, then) {
  view = v;
  animateNext = true;
  try { window.scrollTo(0, 0); } catch {}
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.view === v));
  render();
  if (then) then();
}
function focusForm(arg) {
  const f = document.getElementById("f");
  if (!f) return;
  if (arg === "income" || arg === "expense") {
    const t = document.getElementById("typeSel");
    if (t) { t.value = arg; t.dispatchEvent(new Event("change")); }
  }
  const first = f.querySelector("input:not([type=date])") || f.querySelector("input,select");
  if (first) first.focus();
}

function renderFilters() {
  if (view === "budgets" && F.mode !== "month") { F.mode = "month"; F.month = thisMonth(); }
  const keys = [...new Set([...data.transactions.map((t) => monthKey(t.date)), thisMonth()])].sort().reverse();
  if (!keys.includes(F.month)) keys.push(F.month);
  const years = [...new Set([...data.transactions.map((t) => String(t.date).slice(0, 4)), String(new Date().getFullYear())])].sort().reverse();
  const idx = keys.indexOf(F.month);
  const modes = view === "budgets" ? [["month", "Month"]] : [["month", "Month"], ["year", "Year"], ["range", "Custom range"], ["all", "All time"]];
  let ctl = "";
  if (F.mode === "month") ctl = `<button class="ghost" id="prevM" ${idx >= keys.length - 1 ? "disabled" : ""}>‹</button>
    <select id="monthSel">${keys.map((k) => `<option value="${k}"${k === F.month ? " selected" : ""}>${esc(monthLabel(k))}</option>`).join("")}</select>
    <button class="ghost" id="nextM" ${idx <= 0 ? "disabled" : ""}>›</button><button class="ghost" id="curM">This month</button>`;
  else if (F.mode === "year") ctl = `<select id="yearSel">${years.map((y) => `<option${y === F.year ? " selected" : ""}>${y}</option>`).join("")}</select>`;
  else if (F.mode === "range") ctl = `<input type="date" id="fromD" value="${esc(F.from)}"><span class="muted">to</span><input type="date" id="toD" value="${esc(F.to)}">`;
  let extra = "";
  if (view === "transactions") extra = `<select id="typeF"><option value="all">All types</option><option value="income"${F.type === "income" ? " selected" : ""}>Income</option><option value="expense"${F.type === "expense" ? " selected" : ""}>Expense</option><option value="transfer"${F.type === "transfer" ? " selected" : ""}>Transfers</option></select>
    <select id="catF"><option value="all">All categories</option>${[...new Set([...INCOME_CATS, ...EXPENSE_CATS])].map((c) => `<option${c === F.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  $app.insertAdjacentHTML("afterbegin", `<div class="filters">
    <select id="modeSel">${modes.map(([v, l]) => `<option value="${v}"${v === F.mode ? " selected" : ""}>${l}</option>`).join("")}</select>${ctl}${extra}</div>`);
  const $ = (id) => document.getElementById(id);
  const go = () => render();
  $("modeSel").onchange = (e) => { F.mode = e.target.value; go(); };
  if ($("monthSel")) { $("monthSel").onchange = (e) => { F.month = e.target.value; go(); };
    $("prevM").onclick = () => { F.month = keys[idx + 1]; go(); }; $("nextM").onclick = () => { F.month = keys[idx - 1]; go(); };
    $("curM").onclick = () => { F.month = thisMonth(); go(); }; }
  if ($("yearSel")) $("yearSel").onchange = (e) => { F.year = e.target.value; go(); };
  if ($("fromD")) { $("fromD").onchange = (e) => { F.from = e.target.value; go(); }; $("toD").onchange = (e) => { F.to = e.target.value; go(); }; }
  if ($("typeF")) { $("typeF").onchange = (e) => { F.type = e.target.value; go(); }; $("catF").onchange = (e) => { F.cat = e.target.value; go(); }; }
}

function showLogin() {
  document.body.classList.add("signedout");
  let p = document.getElementById("loginPage");
  if (!p) {
    p = document.createElement("div"); p.id = "loginPage";
    p.innerHTML = `<div class="loginbox">
      <div class="brand"><span class="mark"></span><span class="lbl">Smart<em>Fin</em>Track</span></div>
      <h1>Welcome back</h1>
      <p class="muted">Sign in to see your finances. Your data is private to your Google account.</p>
      <button type="button" class="gbtn" id="loginGo"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg><span>Continue with Google</span></button>
      <p class="muted sm loginnote" id="loginNote"></p>
    </div>`;
    document.body.appendChild(p);
    document.getElementById("loginGo").onclick = () => login();
  }
  document.getElementById("loginGo").hidden = !authReady;
  document.getElementById("loginNote").textContent = authReady ? "We only use your Google account to keep your data separate and private." : "Checking sign-in…";
}

let lastView = null;
function render() {
  saveFilters();
  if (!(mode === "firebase" && !user)) document.body.classList.remove("signedout");
  const keepScroll = lastView === view ? [...$app.querySelectorAll(".scroll")].map((n) => n.scrollTop) : [];
  charts.forEach((c) => c.destroy()); charts = [];
  const $id = (x) => document.getElementById(x);
  const authBtn = $id("authBtn");
  $id("modeBadge").textContent = mode === "demo" ? "Demo mode" : "Firebase";
  $id("userName").textContent = user ? user.displayName || user.email : "";
  $id("railNote").innerHTML = mode === "demo"
    ? "<b>Demo data</b>You're viewing sample data stored in this browser. Add your Firebase config to save your own."
    : "<b>Synced</b>Your data is stored privately in Firebase.";
  $id("railNote").innerHTML += `<div class="muted sm" style="margin-top:6px;opacity:.7">Build ${APP_BUILD}</div>`;
  const ob = overBudget();
  $id("bellDot").hidden = !ob.length; $id("bellDot").textContent = ob.length;
  $id("bell").title = ob.length ? `${ob.length} budget(s) exceeded` : "No budget alerts";
  if (mode === "firebase") {
    authBtn.hidden = false;
    authBtn.textContent = user ? "Sign out" : "Sign in with Google";
    authBtn.onclick = user ? logout : login;
    if (!user) { showLogin(); return; }
  } else {
    authBtn.hidden = false; authBtn.textContent = "Reset demo data";
    authBtn.onclick = () => confirm("Reset to sample data?") && resetDemo();
  }
  $app.classList.add("fit");
  $app.dataset.view = view;
  $app.classList.toggle("enter", animateNext);
  try { views[view](); }
  catch (e) {
    console.error("View failed:", view, e);
    $app.innerHTML = `<div class="empty card"><h2>This page hit an error</h2><p class="muted">${esc(e && e.message || e)}</p></div>`;
  }
  $app.querySelectorAll(".scroll").forEach((n, k) => { if (keepScroll[k]) n.scrollTop = keepScroll[k]; });
  lastView = view;
  if (["overview", "transactions", "budgets"].includes(view)) renderFilters();
  if (animateNext) { animateNext = false; countUp(); }
  const sub = view === "budgets" ? monthLabel(budgetMonth()) : ["overview", "transactions"].includes(view) ? periodLabel() : "All amounts in ₹";
  $app.insertAdjacentHTML("afterbegin", `<h1 class="page-title">${TITLES[view]}</h1><p class="page-sub">${esc(sub)}</p>`);
}

// Skip re-render while the user is typing in a form
onChange(() => {
  const a = document.activeElement;
  const typing = a && $app.contains(a) && ["INPUT", "SELECT"].includes(a.tagName);
  if (!typing) render();
});

document.getElementById("tabs").onclick = (e) => {
  const b = e.target.closest("button[data-view]");
  if (b) goTo(b.dataset.view);
};
document.getElementById("collapseBtn").onclick = () => document.getElementById("shell").classList.toggle("collapsed");
document.getElementById("bell").onclick = () => goTo("budgets");
document.getElementById("q").oninput = (e) => {
  F.q = e.target.value.trim().toLowerCase();
  if (view !== "transactions") { view = "transactions"; document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.view === "transactions")); }
  render();
};

// ---------- wallpaper / background picker ----------
const hills = (fill, d, h) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 320' preserveAspectRatio='none'><path fill='${fill}' d='${d}'/></svg>`)}") bottom / 100% ${h}% no-repeat`;
const H1 = "M0,230 C200,150 320,250 520,170 C720,90 860,230 1060,150 C1240,80 1340,160 1440,120 L1440,320 L0,320Z";
const H2 = "M0,262 C180,212 360,284 560,236 C760,190 960,292 1180,242 C1300,216 1380,252 1440,236 L1440,320 L0,320Z";
const scene = (a, b, top, glow) => `${hills(a, H2, 30)}, ${hills(b, H1, 44)}, ${glow ? glow + ", " : ""}${top}`;
const WALLS = {
  dark: [
    { id: "dusk", name: "Dusk", css: scene("rgba(10,10,30,.55)", "rgba(40,28,80,.5)", "linear-gradient(180deg,#1a1740 0%,#3a2f68 50%,#a9618a 100%) center / cover no-repeat", "radial-gradient(55% 40% at 72% 20%, rgba(255,196,170,.30), transparent 70%)") },
    { id: "ocean", name: "Ocean", css: scene("rgba(6,24,44,.55)", "rgba(14,52,84,.5)", "linear-gradient(180deg,#0a1f36 0%,#12466b 55%,#2a7f94 100%) center / cover no-repeat", "radial-gradient(50% 40% at 25% 15%, rgba(140,220,255,.22), transparent 70%)") },
    { id: "forest", name: "Forest", css: scene("rgba(6,28,22,.55)", "rgba(18,62,48,.5)", "linear-gradient(180deg,#0c2623 0%,#1b4a3f 58%,#3d7a5c 100%) center / cover no-repeat", "radial-gradient(50% 40% at 70% 15%, rgba(190,255,210,.18), transparent 70%)") },
    { id: "slate", name: "Slate", css: "radial-gradient(60% 50% at 80% 10%, rgba(120,140,200,.18), transparent 70%), linear-gradient(160deg,#10151f,#232b3d) center / cover no-repeat" }
  ],
  light: [
    { id: "sky", name: "Sky", css: scene("rgba(120,150,210,.30)", "rgba(150,170,225,.30)", "linear-gradient(180deg,#cfe2ff 0%,#e4dcff 58%,#ffe2d4 100%) center / cover no-repeat", "radial-gradient(50% 40% at 75% 15%, rgba(255,240,200,.7), transparent 70%)") },
    { id: "blush", name: "Blush", css: scene("rgba(200,140,170,.28)", "rgba(220,160,185,.28)", "linear-gradient(180deg,#f6dfe9 0%,#efdcf5 55%,#d9e4ff 100%) center / cover no-repeat") },
    { id: "mint", name: "Mint", css: scene("rgba(90,160,140,.28)", "rgba(120,185,160,.28)", "linear-gradient(180deg,#d8f1ea 0%,#dcecf7 60%,#efe6fb 100%) center / cover no-repeat") },
    { id: "sand", name: "Sand", css: "radial-gradient(60% 50% at 20% 0%, rgba(255,255,255,.7), transparent 70%), linear-gradient(160deg,#f1ebe1,#e6ddd0) center / cover no-repeat" }
  ]
};
const WALL_KEY = "smartfintrack-wall", WALL_IMG = "smartfintrack-wall-img";
let wallPref = { dark: "dusk", light: "sky", custom: false };
try { Object.assign(wallPref, JSON.parse(localStorage.getItem(WALL_KEY) || "{}")); } catch {}
const saveWallPref = () => { try { localStorage.setItem(WALL_KEY, JSON.stringify(wallPref)); } catch {} };
function applyWall() {
  const th = effectiveTheme();
  let img = null; try { img = localStorage.getItem(WALL_IMG); } catch {}
  let value;
  if (wallPref.custom && img) value = `url("${img}") center / cover no-repeat`;
  else { const list = WALLS[th]; value = (list.find((w) => w.id === wallPref[th]) || list[0]).css; }
  document.documentElement.style.setProperty("--wall", value);
}
function renderWallPop() {
  const pop = document.getElementById("wallPop"), th = effectiveTheme();
  let hasImg = false; try { hasImg = !!localStorage.getItem(WALL_IMG); } catch {}
  pop.innerHTML = `<div class="wp-t">Background</div>
    <div class="wp-grid">${WALLS[th].map((w) => `<button class="wp-sw${!wallPref.custom && (wallPref[th] === w.id) ? " on" : ""}" data-wall="${w.id}" style="background:${w.css}" title="${w.name}" aria-label="${w.name}"><span>${w.name}</span></button>`).join("")}
      ${hasImg ? `<button class="wp-sw${wallPref.custom ? " on" : ""}" data-wall="custom" style="background:url('${localStorage.getItem(WALL_IMG)}') center / cover" title="Your image"><span>Yours</span></button>` : ""}</div>
    <label class="wp-up ghost">Upload your own image<input type="file" accept="image/*" id="wallFile" hidden></label>
    ${hasImg ? `<button class="wp-rm ghost" id="wallRm">Remove my image</button>` : ""}
    <div class="wp-note muted" id="wallMsg">Images stay on this device.</div>`;
  pop.querySelectorAll("[data-wall]").forEach((b) => (b.onclick = () => {
    if (b.dataset.wall === "custom") wallPref.custom = true; else { wallPref.custom = false; wallPref[th] = b.dataset.wall; }
    saveWallPref(); applyWall(); renderWallPop();
  }));
  const rm = document.getElementById("wallRm");
  if (rm) rm.onclick = () => { try { localStorage.removeItem(WALL_IMG); } catch {} wallPref.custom = false; saveWallPref(); applyWall(); renderWallPop(); };
  document.getElementById("wallFile").onchange = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const im = new Image(), url = URL.createObjectURL(f);
    im.onload = () => {
      const k = Math.min(1, 1920 / im.width), cv = document.createElement("canvas");
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      try { localStorage.setItem(WALL_IMG, cv.toDataURL("image/jpeg", 0.8)); wallPref.custom = true; saveWallPref(); applyWall(); renderWallPop(); }
      catch { document.getElementById("wallMsg").textContent = "That image is too large to store. Try a smaller one."; }
    };
    im.onerror = () => { document.getElementById("wallMsg").textContent = "Couldn't read that image."; };
    im.src = url;
  };
}
const wallBtn = document.getElementById("wallBtn"), wallPop = document.getElementById("wallPop");
wallBtn.onclick = (e) => { e.stopPropagation(); if (wallPop.hidden) { renderWallPop(); wallPop.hidden = false; } else wallPop.hidden = true; };
document.addEventListener("click", (e) => { if (!wallPop.hidden && !wallPop.contains(e.target) && e.target !== wallBtn) wallPop.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") wallPop.hidden = true; });
applyWall();

const themeBtn = document.getElementById("themeBtn");
const syncThemeBtn = () => { themeBtn.textContent = effectiveTheme() === "dark" ? "☀" : "☾"; themeBtn.title = effectiveTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode"; };
themeBtn.onclick = () => {
  const t = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  syncThemeBtn(); applyWall(); if (!wallPop.hidden) renderWallPop(); render();
};
syncThemeBtn();

init().then(render).catch((err) => { $app.innerHTML = `<div class="card bad">Failed to start: ${esc(err.message)}</div>`; });
