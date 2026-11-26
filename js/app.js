// SmartFinTrack main script (store + UI in one classic script, so index.html also works by double-click)

const firebaseConfig = window.firebaseConfig;
const configured = !!(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_"));
const mode = configured ? "firebase" : "demo";

const COLS = ["transactions", "budgets", "investments", "accounts", "goals", "cards", "subs", "commitments", "planning", "rules", "inbox"];
const data = { transactions: [], budgets: [], investments: [], accounts: [], goals: [], cards: [], subs: [], commitments: [], planning: [], rules: [], inbox: [] };
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
const APP_BUILD = 63;
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
const XFER_CATS = ["Own account", "Loan repayment", "Card bill", "FD / RD", "From friends/family", "Refund", "Cashback"];
const ACCT_ROLES = ["Savings", "Salary", "Current", "UPI spend", "Loan", "Other"];
const EXPENSE_CATS = ["Food", "Rent", "Transport", "Utilities", "Shopping", "Health", "Entertainment", "Subscriptions", "Other"];
const COMMIT_TYPES = ["EMI", "Rent", "Insurance", "School / tuition", "Utilities", "Other"];
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
F.mode = "month"; F.month = thisMonth(); F.type = "all"; F.cat = "all"; F.q = ""; // every visit starts on the current month
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

const PLAN_AREAS = ["Insurance", "Tax", "Retirement", "Estate"];
const PLAN_STATUS = ["On track", "Needs attention", "Action needed"];
const PLAN_DEFAULTS = [
  ["Insurance", "Health insurance", "Family cover that does not depend on your employer"],
  ["Insurance", "Term life insurance", "Cover for dependants, sized to your income and loans"],
  ["Tax", "Tax-saving investments reviewed", "Check 80C / NPS before the financial year ends"],
  ["Tax", "Income-tax return filed", "File on time every year"],
  ["Retirement", "Regular retirement contribution", "EPF, NPS or SIP set up and running"],
  ["Estate", "Nominees updated", "Bank, demat, mutual funds, insurance and EPF"],
  ["Estate", "Will written and stored", "Where family can find it"],
];
const gaugeSvg = (ratio, good) => {
  const r = 60, cx = 70, cy = 66, a = Math.PI * Math.min(1, Math.max(0, ratio));
  const pt = (t) => [cx - r * Math.cos(t), cy - r * Math.sin(t)];
  const [x1, y1] = pt(a);
  return `<svg class="gauge2" viewBox="0 0 140 72" aria-hidden="true"><path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>${ratio > 0 ? `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${good ? "var(--good)" : "var(--c1)"}" stroke-width="10" stroke-linecap="round"/>` : ""}</svg>`;
};

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
  const now = new Date(), today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), thisM = thisMonth();

  // six months ending at the selected period
  const m6 = lastMonths(6), mLab = m6.map((k) => MONTHS[+k.slice(5, 7) - 1]);
  const mSum = (k, ty) => sum(data.transactions.filter((t) => monthKey(t.date) === k && t.type === ty), (t) => t.amount);
  const sInc = m6.map((k) => mSum(k, "income")), sExp = m6.map((k) => mSum(k, "expense"));
  const sNet = sInc.map((v, i) => v - sExp[i]), sRate = sInc.map((v, i) => (v > 0 ? ((v - sExp[i]) / v) * 100 : 0));
  // net worth history is estimated: today's net worth minus the net cash flow of every later month
  const txMonths = [...new Set(data.transactions.map((t) => monthKey(t.date)))];
  const netOf = (k) => mSum(k, "income") - mSum(k, "expense");
  const nwHist = m6.map((k) => nw.total - sum(txMonths.filter((j) => j > k && j <= thisM), netOf));
  const nwChange = nwHist[5] - nwHist[4];

  // spending by category
  const byCat = {};
  tx.filter((t) => t.type === "expense").forEach((t) => (byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount)));
  let cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length > 6) cats = [...cats.slice(0, 5), ["Everything else", cats.slice(5).reduce((s2, c) => s2 + c[1], 0)]];

  // reserves, debt, commitments, cover
  const exp3 = sExp.slice(-3).filter(Boolean), avgExp = exp3.length ? sum(exp3, (x) => x) / exp3.length : exp;
  const liquid = sum(data.accounts.filter((a) => a.kind === "bank account"), (a) => a.value);
  const reserveM = avgExp > 0 ? liquid / avgExp : 0;
  const cmAct = data.commitments.filter((c) => commitActive(c, thisM));
  const emiTotal = sum(cmAct.filter((c) => c.type === "EMI"), (c) => c.amount), cmTotal = sum(cmAct, (c) => c.amount);
  const inc3 = sInc.slice(-3).filter(Boolean);
  const incRef = inc > 0 ? inc : inc3.length ? sum(inc3, (x) => x) / inc3.length : 0;
  const dti = incRef > 0 ? (emiTotal / incRef) * 100 : 0, cmPct = incRef > 0 ? (cmTotal / incRef) * 100 : 0;
  const cardLimit = sum(data.cards, (c) => c.limit), cardOut = sum(data.cards, (c) => c.outstanding), util = cardLimit > 0 ? (cardOut / cardLimit) * 100 : 0;
  const assetsAll = nw.assets + nw.invested, debtRatio = assetsAll > 0 ? (nw.liabilities / assetsAll) * 100 : 0;
  const insured = cmAct.some((c) => c.type === "Insurance") || data.planning.some((p) => p.area === "Insurance" && p.status === "On track");

  // upcoming payments (30 days)
  const nextDate = (day, y, mo) => { let d = dayClamp(y, mo, day); if (d < today0) d = dayClamp(y, mo + 1, day); return d; };
  const dues = [];
  cmAct.forEach((c) => { let d = dayClamp(now.getFullYear(), now.getMonth(), c.day || 1); if (commitPaid(c, thisM) || d < today0) d = dayClamp(now.getFullYear(), now.getMonth() + 1, c.day || 1); dues.push({ d, n: c.name, t: c.type, a: Number(c.amount) || 0 }); });
  data.subs.filter((x) => x.active !== false).forEach((x) => {
    if (x.cycle === "yearly") { let d = dayClamp(now.getFullYear(), Number(x.month) - 1, x.day || 1); if (d < today0) d = dayClamp(now.getFullYear() + 1, Number(x.month) - 1, x.day || 1); dues.push({ d, n: x.name, t: "Subscription", a: Number(x.amount) || 0 }); }
    else dues.push({ d: nextDate(x.day || 1, now.getFullYear(), now.getMonth()), n: x.name, t: "Subscription", a: Number(x.amount) || 0 });
  });
  data.cards.filter((c) => Number(c.outstanding) > 0).forEach((c) => dues.push({ d: nextDate(c.dueDay || 1, now.getFullYear(), now.getMonth()), n: `${c.name} bill`, t: "Card", a: Number(c.outstanding) || 0 }));
  const upcoming = dues.filter((x) => x.d <= new Date(today0.getTime() + 30 * 864e5)).sort((p, q) => p.d - q.d);
  const daysTo = (d) => Math.round((d - today0) / 864e5);

  // debts with interest
  const debts = [...data.accounts.filter((a) => a.kind === "liability").map((a) => ({ n: a.name, v: Number(a.value) || 0, r: a.rate == null || a.rate === "" ? null : Number(a.rate) })),
    ...data.cards.filter((c) => Number(c.outstanding) > 0).map((c) => ({ n: c.name, v: Number(c.outstanding) || 0, r: null }))].sort((p, q) => q.v - p.v);
  const HIGH_RATE = 15;

  // allocation
  const alloc = {};
  if (liquid > 0) alloc["Cash & bank"] = liquid;
  const otherAssets = sum(data.accounts.filter((a) => a.kind === "asset"), (a) => a.value);
  if (otherAssets > 0) alloc["Property & other"] = otherAssets;
  data.investments.forEach((i) => (alloc[i.type] = (alloc[i.type] || 0) + (Number(i.current) || 0)));
  const allocRows = Object.entries(alloc).filter(([, v]) => v > 0).sort((p, q) => q[1] - p[1]);
  const allocTot = sum(allocRows, ([, v]) => v) || 1;

  // alerts table
  const alerts = [];
  overBudget().forEach((b) => alerts.push(["Over budget", b.category, fmt(b.over), `over this month's budget (${esc(monthLabel(bm))})`]));
  cmAct.filter((c) => (c.day || 1) < now.getDate() && !commitPaid(c, thisM)).forEach((c) => alerts.push(["Payment missing", c.name, fmt(c.amount), "not found in your ledger this month"]));
  upcoming.filter((x) => daysTo(x.d) <= 7).forEach((x) => alerts.push(["Due soon", x.n, fmt(x.a), daysTo(x.d) === 0 ? "due today" : `due in ${daysTo(x.d)} day${daysTo(x.d) === 1 ? "" : "s"}`]));
  if (data.inbox.length) alerts.push(["SMS inbox", "Pending review", String(data.inbox.length), "bank SMS waiting on the Ledger page"]);
  if (data.accounts.length && reserveM < 6) alerts.push(["Emergency fund", "Cash reserve", reserveM.toFixed(1) + " mo", "months of spending covered, goal 6"]);
  debts.filter((d) => d.r != null && d.r >= HIGH_RATE).forEach((d) => alerts.push(["High-interest debt", d.n, d.r + "%", "interest a year"]));
  if (emiTotal > 0 && dti > 40) alerts.push(["EMI load", "EMIs vs income", dti.toFixed(0) + "%", "of income, a common limit is 40%"]);
  if (cardLimit > 0 && util > 30) alerts.push(["Card use", "Credit utilisation", util.toFixed(0) + "%", "of limit, under 30% protects your score"]);
  if (!insured) alerts.push(["No cover recorded", "Insurance", "none", "add health and term cover in the checklist"]);
  data.planning.filter((p) => p.status === "Action needed").forEach((p) => alerts.push(["Checklist", p.item, "open", p.area.toLowerCase() + " item needs action"]));
  if (inc > 0 && rate < 20) alerts.push(["Savings rate", "This period", Math.max(0, rate).toFixed(0) + "%", "of income saved, a common target is 20%"]);

  // budget vs actual
  const maxB = Math.max(1, ...data.budgets.map((b) => Math.max(b.limit, budgetSpent(b.category, bm))));
  const budgetRows = data.budgets.map((b) => { const sp = budgetSpent(b.category, bm), over = sp > b.limit;
    return `<div class="d-row"><span>${esc(b.category)}</span><div class="d-track"><div class="d-fill ${over ? "over" : ""}" style="width:${(sp / maxB) * 100}%"></div><i class="d-mark" style="left:${(b.limit / maxB) * 100}%"></i></div><span class="d-val">${fmt(sp)} of ${fmt(b.limit)}${over ? ` · <b class="bad">over</b>` : ""}</span></div>`; }).join("");
  const maxD = Math.max(1, ...debts.map((d) => d.v));
  const debtRows = debts.map((d) => { const high = d.r != null && d.r >= HIGH_RATE;
    return `<div class="d-row"><span>${esc(d.n)}</span><div class="d-track"><div class="d-fill ${high ? "over" : ""}" style="width:${(d.v / maxD) * 100}%"></div></div><span class="d-val">${fmt(d.v)}${d.r != null ? ` at ${d.r}%` : ""}${high ? ` · <b class="bad">high interest</b>` : ""}</span></div>`; }).join("");

  const pl = data.planning.slice().sort((a, b) => PLAN_AREAS.indexOf(a.area) - PLAN_AREAS.indexOf(b.area));
  const plCount = (s) => pl.filter((p) => p.status === s).length;
  const plCol = { "On track": "var(--good)", "Needs attention": "var(--warn)", "Action needed": "var(--bad)" };
  const activeSubs = data.subs.filter((x) => x.active !== false).sort((a, b) => subNext(a) - subNext(b));
  const subMo = sum(activeSubs, subMonthly), subYr = subMo * 12;
  const recent = [...tx].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 7);
  const typeCol = {}; [...new Set(upcoming.map((x) => x.t))].forEach((t, i) => (typeCol[t] = colors[i % 6]));
  const legend = (rows) => rows.map(([n, v], k) => `<div class="d-li"><i class="dot" style="background:${colors[k % 6]}"></i><span>${esc(n)}</span><b>${fmt(v)}</b></div>`).join("");
  const kpi = (label, val, sub, extra = "", cls = "") => `<div class="card d-kpi"><div class="eyebrow">${label}</div><div class="d-kv ${cls}">${val}</div><div class="muted sm">${sub}</div>${extra}</div>`;
  const sgn = (n) => (n >= 0 ? "+" : "−") + fmt(Math.abs(n));

  $app.innerHTML = `
  <div class="dash2">
    <div class="card d-head">
      <h2 class="d-title">Personal finance overview</h2>
      <p class="d-take">Net worth is <b>${fmt(nw.total)}</b>, <b class="${nwChange >= 0 ? "good" : "bad"}">${sgn(nwChange)}</b> over the last month${inc > 0 ? `, and <b>${rate.toFixed(0)}%</b> of income is saved in ${esc(periodLabel())}` : ""}.</p>
    </div>
    <div class="d-kpis">
      ${kpi("Net worth", fmt(nw.total), `<span class="${nwChange >= 0 ? "good" : "bad"}">${sgn(nwChange)}</span> vs last month`, spark(nwHist, "--c1"))}
      ${kpi("Net cash flow", fmt(net), hasPrev() ? `<span class="${net - (pInc - pExp) >= 0 ? "good" : "bad"}">${sgn(net - (pInc - pExp))}</span> vs last period` : esc(periodLabel()), spark(sNet, "--c4"), net < 0 ? "bad" : "")}
      ${kpi("Savings rate", inc > 0 ? rate.toFixed(0) + "%" : "–", "income kept after spending, target 20%", spark(sRate, "--c3"), rate < 0 ? "bad" : "")}
      ${kpi("Total debt", fmt(nw.liabilities), `${debtRatio.toFixed(0)}% of total assets`, `<div class="d-track thin"><div class="d-fill ${debtRatio > 30 ? "over" : ""}" style="width:${Math.min(100, debtRatio)}%"></div></div>`)}
      ${kpi("Emergency fund", reserveM.toFixed(1), "months of spending, goal 6", gaugeSvg(reserveM / 6, reserveM >= 6), reserveM < 3 && data.accounts.length ? "bad" : "")}
      ${kpi("Fixed commitments", fmt(cmTotal), `${cmPct.toFixed(0)}% of income · EMIs ${fmt(emiTotal)}`, `<div class="d-track thin"><div class="d-fill ${cmPct > 50 ? "over" : ""}" style="width:${Math.min(100, cmPct)}%"></div></div>`)}
    </div>
    <div class="card subsdash"><div class="card-title"><h3>My subscriptions</h3><button class="link" data-go="subs">Manage</button></div>
      <p class="muted sm">${activeSubs.length ? `${activeSubs.length} active · ${fmt(subMo)} a month · ${fmt(subYr)} a year` : "Nothing subscribed yet."}</p>
      ${activeSubs.length ? `<div class="subtiles">${activeSubs.map((x) => `<div class="subtile">${subIconFor(x.name, x.category)}<div class="stx"><b>${esc(x.name)}</b><span class="muted sm">${esc(x.category)} · ${x.cycle === "yearly" ? "yearly" : "monthly"}</span></div><div class="sta"><b>${fmt(x.amount)}</b><span class="muted sm">next ${esc(dShort(subNext(x)))}</span></div></div>`).join("")}</div>` : `<p class="muted">Add OTT and other subscriptions to see what you own here.</p>`}</div>
    <div class="d-cols">
      <div class="card"><h3>Net worth, last 6 months</h3><p class="muted sm">Estimated from today's net worth and your monthly cash flow.</p><div class="dchart"><canvas id="dc_nw"></canvas></div></div>
      <div class="card"><h3>Savings rate by month</h3><p class="muted sm">Dashed line is the 20% target.</p><div class="dchart"><canvas id="dc_sr"></canvas></div></div>
    </div>
    <div class="d-cols">
      <div class="card"><h3>Income vs spending</h3><div class="d-legend"><span><i class="dot" style="background:${k1}"></i>Income</span><span><i class="dot" style="background:${k2}"></i>Spending</span></div><div class="dchart"><canvas id="dc_cf"></canvas></div></div>
      <div class="card"><div class="card-title"><h3>Where the money went</h3><button class="link" data-go="transactions">Ledger</button></div><p class="muted sm">${esc(periodLabel())}</p>
        <div class="d-ring"><div class="dring"><canvas id="dc_sp"></canvas><div class="dtot"><b>${compact(exp)}</b><small>spent</small></div></div><div class="d-leg">${cats.length ? legend(cats) : `<span class="muted">No expenses in this period.</span>`}</div></div></div>
    </div>
    <div class="d-cols">
      <div class="card"><div class="card-title"><h3>Budget vs actual</h3><button class="link" data-go="budgets">Edit</button></div><p class="muted sm">Bar is actual spending, the tick is the budget. Over budget is red. Fixed commitments (${fmt(cmTotal)}) sit outside budgets.</p>${budgetRows || `<p class="muted">Set category budgets to compare plan with actual spending.</p>`}</div>
      <div class="card"><div class="card-title"><h3>Where your assets are</h3><button class="link" data-go="investments">Holdings</button></div>
        ${allocRows.length ? `<div class="d-ring"><div class="dring"><canvas id="dc_al"></canvas><div class="dtot"><b>${compact(allocTot)}</b><small>assets</small></div></div><div class="d-leg">${legend(allocRows)}</div></div>` : `<p class="muted">Add bank accounts and holdings to see your mix.</p>`}</div>
    </div>
    <div class="d-cols">
      <div class="card w6"><div class="card-title"><h3>Debt and interest</h3><button class="link" data-go="networth">Edit</button></div><p class="muted sm">Bar length is the amount owed. Add an interest rate to a loan under Net worth.</p>${debtRows || `<p class="muted">No debts recorded.</p>`}</div>
      <div class="card w6"><div class="card-title"><h3>Bills coming up</h3><button class="link" data-go="budgets">Commitments</button></div><p class="muted sm">Next 30 days · ${fmt(sum(upcoming, (x) => x.a))}</p>
        ${upcoming.length ? `<div class="d-legend">${Object.entries(typeCol).map(([t, c]) => `<span><i class="dot" style="background:${c}"></i>${esc(t)}</span>`).join("")}</div><div class="dchart short"><canvas id="dc_bl"></canvas></div>` : `<p class="muted">Nothing due in the next 30 days.</p>`}</div>
    </div>
    <div class="card alertsbox"><h3>Alerts</h3>
      <div class="scroll"><table><thead><tr><th>Alert</th><th>Item</th><th class="num">Value</th><th>Meaning</th></tr></thead>
      <tbody>${alerts.map(([a, i, v, m]) => `<tr><td>${esc(a)}</td><td>${esc(i)}</td><td class="num">${esc(v)}</td><td class="muted">${m}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No alerts right now.</td></tr>`}</tbody></table></div></div>
    <div class="d-cols">
      <div class="card w6"><h3>Upcoming bills and subscriptions</h3>
        <div class="scroll"><table><thead><tr><th>Bill</th><th>Type</th><th>Due</th><th class="num">Amount</th></tr></thead>
        <tbody>${upcoming.map((x) => `<tr><td>${esc(x.n)}</td><td><span class="pill">${esc(x.t)}</span></td><td>${esc(dShort(x.d))} <span class="muted sm">${daysTo(x.d) === 0 ? "today" : "in " + daysTo(x.d) + "d"}</span></td><td class="num">${fmt(x.a)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Nothing due in 30 days.</td></tr>`}</tbody></table></div></div>
      <div class="card w6" id="planBox"><div class="card-title"><h3>Insurance, tax, retirement and estate checklist</h3>${pl.length ? "" : `<button type="button" class="ghost sm" id="plSeed">Add starter list</button>`}</div>
        ${pl.length ? `<div class="d-seg">${PLAN_STATUS.filter((s) => plCount(s)).map((s) => `<i style="flex:${plCount(s)};background:${plCol[s]}"></i>`).join("")}</div><div class="d-legend">${PLAN_STATUS.map((s) => `<span><i class="dot" style="background:${plCol[s]}"></i><b>${plCount(s)}</b> ${s}</span>`).join("")}</div>` : `<p class="muted sm">Track the non-money parts of your plan: cover, tax, retirement and estate. Tap a status to change it.</p>`}
        ${pl.length ? `<div class="scroll"><table><thead><tr><th>Area</th><th>Item</th><th>Status</th><th></th></tr></thead><tbody>${pl.map((p) => `<tr><td>${esc(p.area)}</td><td>${esc(p.item)}<div class="muted sm">${esc(p.detail || "")}</div></td><td><button type="button" class="pill planst" data-pl="${esc(p.id)}" style="border-color:${plCol[p.status] || "var(--line)"};color:${plCol[p.status] || "inherit"}">${esc(p.status)}</button></td><td><button class="del" data-del="${esc(p.id)}" title="Delete">✕</button></td></tr>`).join("")}</tbody></table></div>` : ""}
        <form class="inline" id="plf"><select name="area">${opts(PLAN_AREAS)}</select><input name="item" placeholder="Add item" required maxlength="80"><input name="detail" placeholder="Detail (optional)" maxlength="120"><button class="primary">Add</button></form></div>
    </div>
    <div class="card hist2"><div class="card-title"><h3>Recent transactions</h3><button class="link" data-go="transactions">View all</button></div>
      <div class="txlist">${recent.map((t) => `<div class="tx">${txIcon(t) || `<div class="avatar" style="background:linear-gradient(135deg,${catColor(t.category)},${lighten(catColor(t.category), 0.45)})">${esc((t.note || t.category).charAt(0).toUpperCase())}</div>`}
        <div><div class="t">${esc(t.note || t.category)}</div><div class="s">${esc(t.date)} · ${esc(t.category)}</div></div>
        <div class="a ${t.type === "income" ? "good" : t.type === "transfer" ? "muted" : ""}">${txAmt(t)}</div></div>`).join("") || `<span class="muted">No transactions in this period.</span>`}</div></div>
  </div>`;

  const grid = css("--line"), tc = css("--text");
  const yk = { grid: { color: grid }, border: { display: false }, ticks: { color: tc, callback: (v) => (Math.abs(v) >= 1000 ? v / 1000 + "k" : v) } };
  const base = { maintainAspectRatio: false, plugins: { legend: { display: false } } };
  const line = (label, d, col) => ({ label, data: d, borderColor: col, backgroundColor: hexA(col, 0.12), fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3.5, pointBackgroundColor: col });
  chart("dc_nw", { type: "line", data: { labels: mLab, datasets: [line("Net worth", nwHist, k1)] }, options: { ...base, scales: { x: { grid: { display: false }, ticks: { color: tc } }, y: yk }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.y)}` } } } } });
  chart("dc_sr", { type: "line", data: { labels: mLab, datasets: [line("Savings rate", sRate.map((v) => Math.round(v * 10) / 10), k3), { label: "Target", data: mLab.map(() => 20), borderColor: hexA(k3, 0.6), borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, fill: false }] },
    options: { ...base, scales: { x: { grid: { display: false }, ticks: { color: tc } }, y: { ...yk, ticks: { color: tc, callback: (v) => v + "%" } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y}%` } } } } });
  chart("dc_cf", { type: "bar", data: { labels: mLab, datasets: [{ label: "Income", data: sInc, backgroundColor: k1, borderRadius: 4 }, { label: "Spending", data: sExp, backgroundColor: k2, borderRadius: 4 }] },
    options: { ...base, scales: { x: { grid: { display: false }, ticks: { color: tc } }, y: yk }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } } } });
  const donut = (id, rows) => chart(id, { type: "doughnut", data: { labels: rows.length ? rows.map((c) => c[0]) : ["None"], datasets: [{ data: rows.length ? rows.map((c) => c[1]) : [1], backgroundColor: rows.length ? gradBg(colors) : [grid], borderColor: css("--card"), borderWidth: 2 }] },
    options: { cutout: "66%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)}` } } } } });
  donut("dc_sp", cats); donut("dc_al", allocRows);
  chart("dc_bl", { type: "bar", data: { labels: upcoming.map((x) => dShort(x.d)), datasets: [{ data: upcoming.map((x) => x.a), backgroundColor: upcoming.map((x) => typeCol[x.t]), borderRadius: 4 }] },
    options: { ...base, scales: { x: { grid: { display: false }, ticks: { color: tc } }, y: yk }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => upcoming[c[0].dataIndex].n, label: (c) => ` ${fmt(c.parsed.y)}` } } } } });

  $app.querySelectorAll("[data-go]").forEach((el) => (el.onclick = () => { const [v, arg] = el.dataset.go.split(":"); goTo(v, () => focusForm(arg)); }));
  const planBox = document.getElementById("planBox");
  const seed = document.getElementById("plSeed");
  if (seed) seed.onclick = async () => { seed.disabled = true; for (const [area, item, detail] of PLAN_DEFAULTS) await add("planning", { area, item, detail, status: "Action needed" }); };
  document.getElementById("plf").onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); await add("planning", { area: f.get("area"), item: f.get("item").trim(), detail: String(f.get("detail") || "").trim(), status: "Action needed" }); };
  planBox.querySelectorAll("[data-pl]").forEach((b) => (b.onclick = () => { const p = data.planning.find((x) => x.id === b.dataset.pl); if (p) update("planning", p.id, { status: PLAN_STATUS[(PLAN_STATUS.indexOf(p.status) + 1) % 3] }); }));
  bindDelete("planning", planBox);
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
    ${window.smsCard ? window.smsCard() : ""}
    <div class="card">
      <h2 class="h2row">Add transaction <span><button type="button" class="ghost sm" id="impBtn">⬆ Import statements</button> <button type="button" class="ghost sm" id="clrBtn">🗑 Clear imported</button></span></h2>
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
      <tbody>${rows.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.type)}</td><td>${esc(t.category)}</td><td>${txIcon(t) ? `<span class="notecell">${txIcon(t)}${esc(t.note)}</span>` : esc(t.note)}${t.account ? ` <span class="acctag">${esc(t.account)}</span>` : ""}${t.src === "sms" ? ` <span class="acctag" title="${esc(t.raw || "Added from a bank SMS")}">SMS</span>` : ""}</td>
        <td class="num ${txCls(t)}">${txAmt(t)}</td>
        <td><button class="del" data-del="${esc(t.id)}" title="Delete">✕</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No transactions yet.</td></tr>`}</tbody></table></div>
    </div>
    <div class="card xferbox">
      <div class="card-title"><h3>Transfers and non-salary credits</h3><button type="button" class="ghost sm" id="xferScan">Find transfers in my entries</button></div>
      <p class="muted">Counted separately: not income, not expense, not in savings rate. Own-account moves, money from friends/family, refunds and cashback land here; only salary counts as income. ${xf.length} entr${xf.length === 1 ? "y" : "ies"} · Moved out <b>${fmt(xOut)}</b> · Moved in <b>${fmt(xIn)}</b> · Net left your accounts <b>${fmt(xOut - xIn)}</b> <span class="sm">(loans, FDs or accounts you haven't imported)</span></p>
      ${xf.length ? `<div class="scroll"><table><thead><tr><th>Account</th><th class="num">Out</th><th class="num">In</th><th class="num">Net</th></tr></thead><tbody>${Object.entries(xAcc).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmt(v.o)}</td><td class="num">${fmt(v.i)}</td><td class="num">${fmt(v.i - v.o)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted sm">None yet. Import statements from several accounts, add your accounts under Net worth (with account numbers / UPI ids), or tap Find transfers.</p>`}
    </div>`;
  if (window.smsBind) window.smsBind($app);
  document.getElementById("xferScan").onclick = () => window.impScanLedger && window.impScanLedger();
  document.getElementById("impBtn").onclick = () => window.openImport && window.openImport();
  document.getElementById("clrBtn").onclick = () => window.impClear && window.impClear();
  const typeSel = document.getElementById("typeSel");
  typeSel.onchange = () => (document.getElementById("catSel").innerHTML = opts(typeSel.value === "income" ? INCOME_CATS : EXPENSE_CATS));
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("transactions", { type: f.get("type"), category: f.get("category"), amount: Number(f.get("amount")), date: f.get("date"), note: f.get("note") });
  };
  bindDelete("transactions");
}

// fixed monthly commitments (EMIs, rent, insurance, fees): must be paid, kept apart from budget allocation
const commitActive = (c, m) => !c.until || String(c.until) >= m;
const commitLeft = (c, m) => (c.until ? (+c.until.slice(0, 4) - +m.slice(0, 4)) * 12 + (+c.until.slice(5, 7) - +m.slice(5, 7)) + 1 : null);
function commitPaid(c, m) {
  const nm = String(c.name || "").trim().toLowerCase(), amt = Number(c.amount) || 0;
  return data.transactions.find((t) => monthKey(t.date) === m && (t.type === "expense" || (t.type === "transfer" && t.dir !== "in")) &&
    ((nm.length >= 3 && String(t.note || "").toLowerCase().includes(nm)) || (amt > 0 && Math.abs(Number(t.amount) - amt) < 1 && (t.category === c.type || /emi|loan|rent|insur/i.test(`${t.category} ${t.note}`)))));
}
function budgets() {
  const m = budgetMonth();
  const spent = (cat) => sum(data.transactions.filter((t) => t.type === "expense" && t.category === cat && monthKey(t.date) === m), (t) => t.amount);
  const cm = data.commitments.filter((c) => commitActive(c, m)).sort((a, b) => (a.day || 0) - (b.day || 0));
  const cTotal = sum(cm, (c) => c.amount), paidList = cm.map((c) => [c, commitPaid(c, m)]);
  const cPaid = sum(paidList.filter(([, p]) => p), ([c]) => c.amount);
  const monthInc = (k) => sum(data.transactions.filter((t) => t.type === "income" && monthKey(t.date) === k), (t) => t.amount);
  let income = monthInc(m), incLabel = "Income this month";
  if (!income) {
    const prev = [1, 2, 3].map((i) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 - i, 1); return monthInc(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }).filter(Boolean);
    if (prev.length) { income = sum(prev, (x) => x) / prev.length; incLabel = "Expected income (recent average)"; }
  }
  const bTotal = sum(data.budgets, (b) => b.limit), free = income - cTotal - bTotal;
  const today = new Date(), isNow = m === thisMonth();
  $app.innerHTML = `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">${incLabel}</div><div class="value">${fmt(income)}</div></div>
      <div class="card kpi"><div class="label">Fixed commitments</div><div class="value">${fmt(cTotal)}</div><div class="muted sm">${fmt(cPaid)} paid · ${fmt(cTotal - cPaid)} to go</div></div>
      <div class="card kpi"><div class="label">Budgets allocated</div><div class="value">${fmt(bTotal)}</div></div>
      <div class="card kpi"><div class="label">Left after both</div><div class="value ${free >= 0 ? "good" : "bad"}">${fmt(free)}</div></div>
    </div>
    <div class="card" id="commitBox">
      <h2>Fixed monthly commitments (${m})</h2>
      <p class="muted sm">EMIs and expenses that cannot be skipped. They are separate from budgets and come off your income first. A commitment shows as paid when a matching ledger entry (same name or amount) exists this month.</p>
      <form class="inline" id="cf">
        <input name="name" placeholder="Name (e.g. Home loan EMI)" required maxlength="60">
        <select name="type">${opts(COMMIT_TYPES)}</select>
        <input name="amount" type="number" min="1" step="0.01" placeholder="Amount (₹ / month)" required>
        <input name="day" type="number" min="1" max="31" placeholder="Due day" required>
        <input name="until" type="month" title="Last month (optional, for EMIs)">
        <button class="primary">Add</button>
      </form>
      <div class="scroll"><table><thead><tr><th>Name</th><th>Type</th><th class="num">Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${paidList.map(([c, p]) => {
        const left = commitLeft(c, m), late = !p && isNow && (c.day || 1) < today.getDate();
        return `<tr><td>${esc(c.name)}${left ? ` <span class="muted sm">${left} month${left === 1 ? "" : "s"} left</span>` : ""}</td><td><span class="pill">${esc(c.type)}</span></td>
        <td class="num">${fmt(c.amount)}</td><td>${esc(c.day || 1)}</td>
        <td>${p ? `<span class="pill ok">Paid ${esc(String(p.date).slice(5))}</span>` : late ? `<span class="pill bad">Overdue?</span>` : `<span class="pill">Due</span>`}</td>
        <td><button class="del" data-del="${esc(c.id)}" title="Delete">✕</button></td></tr>`;
      }).join("") || `<tr><td colspan="6" class="muted">No fixed commitments yet.</td></tr>`}</tbody></table></div>
    </div>
    <div class="card" id="budgetBox">
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
  document.getElementById("cf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("commitments", { name: f.get("name").trim(), type: f.get("type"), amount: Number(f.get("amount")), day: Math.min(31, Math.max(1, Number(f.get("day")) || 1)), until: f.get("until") || "" });
  };
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("budgets", { category: f.get("category"), limit: Number(f.get("limit")) });
  };
  bindDelete("commitments", document.getElementById("commitBox"));
  bindDelete("budgets", document.getElementById("budgetBox"));
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

const RULE_DEFAULTS = { salary: "", refund: "refund, reversal, chargeback, refd, returned", cashback: "cashback, cash back, reward" };
const KW_CLASSES = ["Own account", "Loan repayment", "Card bill", "FD / RD", "From friends/family", "Refund", "Cashback", "Salary"];
const splitWords = (v) => String(v || "").split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3);
const customKw = () => data.rules.filter((x) => x.kind === "kw" && x.words).map((x) => ({ words: splitWords(x.words), cls: x.cls || "Own account" }));
window.customKw = customKw;
const ruleWords = (kind) => {
  const r = data.rules.find((x) => x.kind === kind), cls = { salary: "Salary", refund: "Refund", cashback: "Cashback" }[kind];
  const extra = cls ? customKw().filter((k) => k.cls === cls).flatMap((k) => k.words) : [];
  return splitWords(r ? r.words : RULE_DEFAULTS[kind] || "").concat(extra);
};
window.ruleWords = ruleWords;
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
          <input name="rate" type="number" min="0" step="0.1" placeholder="Interest % a year (loans)" title="Optional, shown in Debt and interest on the dashboard">
          <input name="value" type="number" min="0" step="0.01" placeholder="Value (₹)" required>
          <button class="primary">Add</button>
        </form>
        <div class="scroll"><table><thead><tr><th>Name</th><th>Kind</th><th class="num">Value</th><th></th></tr></thead>
        <tbody>${data.accounts.map((a) => `<tr><td><div class="subname"><label class="icopick" title="Click to use your own icon">${acctIcon(a)}<input type="file" accept="image/*" data-ico="${esc("acct:" + a.name.toLowerCase())}" hidden></label><span>${esc(a.name)}${subIcons["acct:" + a.name.toLowerCase()] ? ` <a href="#" class="link" data-icoreset="${esc("acct:" + a.name.toLowerCase())}">reset</a>` : ""}</span></div></td><td><span class="pill ${a.kind === "liability" ? "bad" : a.kind === "bank account" ? "ok" : ""}">${a.kind === "bank account" ? "Bank account" : a.kind === "asset" ? "Other asset" : "Liability"}</span>${a.role ? ` <span class="muted sm">${esc(a.role)}</span>` : ""}${a.match ? `<div class="muted sm" title="Used to recognise transfers in statements">🔗 ${esc(a.match)}</div>` : ""}${a.phone ? `<div class="muted sm" title="Own number: payments to it count as own transfers">📱 ${esc(a.phone)}</div>` : ""}</td>
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
    </div>
    <div class="card rulebox">
      <h2>Credit/Debit classification keywords</h2>
      <p class="muted sm">Used when importing statements, reading SMS and in "Find transfers". Only salary counts as income. Separate words with commas, matching ignores capitals.</p>
      <form id="ruleForm" class="rulegrid">
        <label>Salary: employer name<input name="salary" value="${esc(((data.rules.find((x) => x.kind === "salary") || {}).words) || "")}" placeholder="e.g. VIVIDMINDS" maxlength="120"></label>
        <label>Refund<input name="refund" value="${esc(((data.rules.find((x) => x.kind === "refund") || { words: RULE_DEFAULTS.refund }).words))}" maxlength="160"></label>
        <label>Cashback<input name="cashback" value="${esc(((data.rules.find((x) => x.kind === "cashback") || { words: RULE_DEFAULTS.cashback }).words))}" maxlength="160"></label>
        <label>From friends/family<input value="Any other credit" disabled></label>
        <div class="rulenote"><h3 class="rulesub">Own accounts: account numbers, UPI IDs, names and phone numbers</h3>
          <p class="muted sm">Any debit or credit that mentions these is an own-account transfer, not income or expense. Add your account numbers (or last 3-4 digits), UPI IDs, your name text and phone / UPI numbers.</p>
          ${data.accounts.length ? `<div class="scroll"><table class="ownids"><thead><tr><th>Account</th><th>Account no. / UPI id / name</th><th>Phone / UPI number</th></tr></thead><tbody>${data.accounts.map((a) => `<tr data-acc="${esc(a.id)}"><td>${esc(a.name)}${a.role ? ` <span class="muted sm">${esc(a.role)}</span>` : ""}</td><td><input data-am value="${esc(a.match || "")}" placeholder="e.g. 8050, name@okhdfc, NALLAJAR" maxlength="120"></td><td><input data-ap value="${esc(a.phone || "")}" placeholder="10 digits, comma separated" maxlength="60"></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted sm">Add your accounts above first, then add their numbers here.</p>`}</div>
        <div class="rulenote"><h3 class="rulesub">Other keywords: any text from a transaction</h3>
          <p class="muted sm">Type any name, UPI id, phone, merchant or phrase that appears in a transaction and choose how it is classified. Example: <b>nallajarla upen</b> → Own account.</p>
          <div class="scroll"><table class="ownids kwtable"><tbody>${data.rules.filter((x) => x.kind === "kw").map((k) => `<tr data-kw="${esc(k.id)}"><td><input data-kww value="${esc(k.words || "")}" maxlength="120"></td><td><select data-kwc>${opts(KW_CLASSES, k.cls || "Own account")}</select></td><td><button type="button" class="del" data-kwdel="${esc(k.id)}" title="Remove">✕</button></td></tr>`).join("")}
          <tr><td><input name="kwnew" placeholder="e.g. nallajarla upen, rent, john@okaxis" maxlength="120"></td><td><select name="kwcls">${opts(KW_CLASSES, "Own account")}</select></td><td><button type="button" class="ghost sm" id="kwAdd">Add</button></td></tr></tbody></table></div></div>
        <div class="rulenote muted sm">"salary", "payroll" and bank interest are always recognised. Refunds, cashback and friends/family are kept out of income.</div>
        <button class="primary">Save keywords</button>
      </form>
    </div>`;
  document.getElementById("ruleForm").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    // read everything first: each write re-renders the page and would reset the inputs
    const accChanges = [...document.querySelectorAll("#ruleForm tr[data-acc]")].map((tr) => {
      const a = data.accounts.find((x) => x.id === tr.dataset.acc); if (!a) return null;
      const match = tr.querySelector("[data-am]").value.trim(), phone = tr.querySelector("[data-ap]").value.trim();
      return match !== (a.match || "") || phone !== (a.phone || "") ? { id: a.id, match, phone } : null;
    }).filter(Boolean);
    const kwChanges = [...document.querySelectorAll("#ruleForm tr[data-kw]")].map((tr) => {
      const k = data.rules.find((x) => x.id === tr.dataset.kw); if (!k) return null;
      const words = tr.querySelector("[data-kww]").value.trim(), cls = tr.querySelector("[data-kwc]").value;
      return words !== (k.words || "") || cls !== (k.cls || "Own account") ? { id: k.id, words, cls } : null;
    }).filter(Boolean);
    const kwNew = String(f.get("kwnew") || "").trim(), kwCls = String(f.get("kwcls") || "Own account");
    for (const kind of ["salary", "refund", "cashback"]) {
      const words = String(f.get(kind) || "").trim(), cur = data.rules.find((x) => x.kind === kind);
      if (cur) { if (cur.words !== words) await update("rules", cur.id, { words }); } else await add("rules", { kind, words });
    }
    for (const c of accChanges) await update("accounts", c.id, { match: c.match, phone: c.phone });
    for (const c of kwChanges) await update("rules", c.id, { words: c.words, cls: c.cls });
    if (kwNew) await add("rules", { kind: "kw", words: kwNew, cls: kwCls });
    authToast("Saved");
  };
  document.getElementById("kwAdd").onclick = () => document.getElementById("ruleForm").requestSubmit();
  document.querySelectorAll("[data-kwdel]").forEach((b) => (b.onclick = () => remove("rules", b.dataset.kwdel)));
  chart("c1", { type: "bar", data: { labels: ["Cash & assets", "Investments", "Liabilities (incl. cards)"],
    datasets: [{ data: [nw.assets, nw.invested, nw.liabilities], backgroundColor: gradBg([css("--c1"), css("--c4"), css("--c2")]), borderRadius: 10, borderSkipped: false }] },
    options: { plugins: { legend: { display: false } } } });
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await add("accounts", { name: f.get("name"), kind: f.get("kind"), role: f.get("role") || "", rate: f.get("rate") === "" ? null : Number(f.get("rate")), value: Number(f.get("value")) });
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
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: css("--text") } } } } });

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
  accounts: [["name", "Name", "text"], ["kind", "Type", "select", [["bank account", "Bank account"], ["asset", "Other asset"], ["liability", "Liability"]]], ["role", "Role", "select", ["", ...ACCT_ROLES]], ["rate", "Interest % a year (loans, optional)", "number"], ["value", "Value (₹)", "number"]],
  goals: [["name", "Goal name", "text"], ["target", "Target (₹)", "number"], ["saved", "Saved so far (₹)", "number"]],
  cards: [["name", "Card name", "text"], ["last4", "Last 4 digits", "text"], ["network", "Network", "select", NETS], ["limit", "Credit limit (₹)", "number"], ["outstanding", "Outstanding (₹)", "number"], ["dueDay", "Due day (1-31)", "number"]],
  planning: [["area", "Area", "select", PLAN_AREAS], ["item", "Item", "text"], ["detail", "Detail", "text"], ["status", "Status", "select", PLAN_STATUS]],
  commitments: [["name", "Name", "text"], ["type", "Type", "select", COMMIT_TYPES], ["amount", "Amount (₹ / month)", "number"], ["day", "Due day (1-31)", "number"], ["until", "Last month (optional, for EMIs)", "month"]],
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
    if (col === "commitments") patch.day = Math.min(31, Math.max(1, patch.day || 1));
    if (col === "cards") patch.dueDay = Math.min(31, Math.max(1, patch.dueDay || 1));
    close();
    await update(col, id, patch);
  };
  form.querySelector("input,select").focus();
}
function bindDelete(col, root = $app) {
  root.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => remove(col, b.dataset.del);
    if (!b.previousElementSibling?.matches?.("[data-edit]")) {
      const e = document.createElement("button");
      e.className = "del edit"; e.dataset.edit = b.dataset.del; e.title = "Edit"; e.setAttribute("aria-label", "Edit"); e.textContent = "✎";
      b.before(e);
    }
  });
  root.querySelectorAll("[data-edit]").forEach((e) => (e.onclick = () => openEdit(col, e.dataset.edit)));
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
  const rn = $id("railNote");
  rn.innerHTML = `<i class="sdot ${mode === "demo" ? "demo" : ""}"></i>${mode === "demo" ? "Demo" : "Synced"} · v${APP_BUILD}`;
  rn.title = mode === "demo" ? "Sample data stored in this browser. Add your Firebase config to save your own." : "Your data is stored privately in Firebase.";
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
  $app.classList.remove("fit");
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
