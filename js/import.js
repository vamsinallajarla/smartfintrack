// Statement import: CSV / Excel bank or card statements -> ledger transactions.
// Classic script, loaded after app.js (shares its globals: data, add, esc, fmt, opts, ...).

const IMP_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const IMP_RULES = [
  ["Subscriptions", /netflix|spotify|hotstar|prime video|amazon prime|youtube ?premium|icloud|apple\.com\/bill|google ?one|sonyliv|zee5|jiocinema|audible|canva|adobe|microsoft 365/i],
  ["Food", /swiggy|zomato|restaurant|cafe|dominos|domino's|mcdonald|kfc|pizza|burger|bigbasket|blinkit|zepto|instamart|grocer|supermarket|dmart|bakery|starbucks/i],
  ["Transport", /uber|\bola\b|rapido|irctc|petrol|diesel|fuel|hpcl|bpcl|iocl|indian ?oil|metro|fastag|redbus|makemytrip|airlines|indigo|railway/i],
  ["Utilities", /electric|bescom|msedcl|bses|tata power|adani|airtel|\bjio\b|vodafone|\bvi\b|recharge|broadband|\bgas\b|water bill|bsnl|dth|tata ?play|postpaid|act fibernet|lpg/i],
  ["Shopping", /amazon|flipkart|myntra|ajio|nykaa|meesho|tata ?cliq|croma|reliance digital|lenskart|decathlon|ikea/i],
  ["Health", /pharm|apollo|medplus|hospital|clinic|1mg|netmeds|diagnos|lab\b|dental|practo/i],
  ["Entertainment", /bookmyshow|pvr|inox|cinema|movie|gaming|steam|playstation|dream11/i],
  ["Rent", /\brent\b|landlord|housing society|maintenance/i],
];
const IMP_INCOME_RULES = [
  ["Salary", /salary|payroll|stipend|wages/i],
  ["Interest", /interest|int\.?\s?pd|int\.?\s?credit|dividend/i],
  ["Business", /invoice|client|consult|freelance|business/i],
];

let imp = null; // current import session

// ---------- parsing helpers ----------
function impParseCSV(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/).slice(0, 15).join("\n");
  const delim = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

function impParseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return isoDate(v);
  let s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((Number(s) - 25569) * 86400000)); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  let m;
  const mk = (y, mo, d) => {
    y = Number(y); mo = Number(mo); d = Number(d);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  };
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return mk(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.\s]([A-Za-z]{3,9})[-/.\s,]*(\d{2,4})$/))) { const mo = IMP_MONTHS[m[2].slice(0, 4).toLowerCase()] || IMP_MONTHS[m[2].slice(0, 3).toLowerCase()]; return mo ? mk(m[3], mo, m[1]) : null; }
  if ((m = s.match(/^([A-Za-z]{3,9})\s(\d{1,2})\s(\d{2,4})$/))) { const mo = IMP_MONTHS[m[1].slice(0, 3).toLowerCase()]; return mo ? mk(m[3], mo, m[2]) : null; }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) return mk(m[3], m[2], m[1]); // India: dd/mm/yyyy
  return null;
}

function impNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim(); if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || /-/.test(s.replace(/^[^\d-]*/, "").slice(0, 1)) || /\bdr\b/i.test(s);
  s = s.replace(/[₹$,\s]|rs\.?|inr|cr\b|dr\b|\(|\)/gi, "").replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

function impFindHeader(rows) {
  const key = /date|narration|description|particulars|details|remarks|withdraw|deposit|debit|credit|amount|balance|dr\s*\/?\s*cr/i;
  let best = 0, bi = 0;
  rows.slice(0, 60).forEach((r, i) => {
    const hits = r.filter((c) => c && c.length < 40 && key.test(c)).length;
    if (hits > best) { best = hits; bi = i; }
  });
  return best >= 2 ? bi : 0;
}

function impDetect(head) {
  const find = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  let date = find(/(txn|transaction|posting|trans)\.?\s*date/i); if (date < 0) date = find(/^date|date$/i, /value/i); if (date < 0) date = find(/date/i);
  const desc = (() => { const i = find(/narration|description|particulars|transaction remarks|details|remarks/i); return i; })();
  const debit = find(/withdraw|debit|paid out|spent|\bdr\b(?!\s*\/)/i, /dr\s*\/?\s*cr|cr\s*\/?\s*dr|balance/i);
  const credit = find(/deposit|credit|paid in|received|\bcr\b(?!\s*\/)/i, /dr\s*\/?\s*cr|cr\s*\/?\s*dr|balance|card/i);
  const amount = find(/^amount|amount\s*\(|txn amount|transaction amount/i, /balance/i);
  const drcr = find(/dr\s*\/?\s*cr|cr\s*\/?\s*dr|^type$|txn type|transaction type/i);
  return { date, desc, debit, credit, amount, drcr };
}

function impGuess(desc, type) {
  const sub = data.subs.find((s) => String(desc).toLowerCase().includes(String(s.name).toLowerCase()));
  if (type === "expense" && sub) return "Subscriptions";
  const rules = type === "income" ? IMP_INCOME_RULES : IMP_RULES;
  for (const [c, re] of rules) if (re.test(desc)) return c;
  return "Other";
}

function impBuild() {
  const { rows, headerIdx, map, noSign } = imp;
  const out = [];
  const hasNeg = map.amount >= 0 && map.drcr < 0 && rows.slice(headerIdx + 1).some((r) => (impNum(r[map.amount]) || 0) < 0);
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i], g = (k) => (map[k] >= 0 ? r[map[k]] : undefined);
    const date = impParseDate(g("date"));
    if (!date) continue;
    let amt = 0, type = null;
    if (map.debit >= 0 || map.credit >= 0) {
      const d = Math.abs(impNum(g("debit")) || 0), c = Math.abs(impNum(g("credit")) || 0);
      if (d > 0 && c === 0) { amt = d; type = "expense"; } else if (c > 0 && d === 0) { amt = c; type = "income"; }
      else if (d > 0 && c > 0) { amt = Math.abs(c - d); type = c > d ? "income" : "expense"; }
    }
    if (!type && map.amount >= 0) {
      const raw = impNum(g("amount"));
      if (raw != null && raw !== 0) {
        amt = Math.abs(raw);
        const t = map.drcr >= 0 ? String(g("drcr") || "").toLowerCase() : "";
        const rawStr = String(g("amount") || "");
        if (/^(c|cr|credit|deposit)\b/.test(t) || /\bcr\b/i.test(rawStr)) type = "income";
        else if (/^(d|dr|debit|withdraw)/.test(t) || /\bdr\b/i.test(rawStr)) type = "expense";
        else if (raw < 0) type = "expense";
        else type = hasNeg ? "income" : noSign; // signed statements: + is money in
      }
    }
    if (!type || !(amt > 0)) continue;
    const note = String(g("desc") || "").replace(/\s+/g, " ").trim().slice(0, 120);
    out.push({ date, type, amount: Math.round(amt * 100) / 100, note, category: impGuess(note, type) });
  }
  // duplicate detection against the ledger (date + type + amount), honouring multiplicity
  const seen = {};
  data.transactions.forEach((t) => { const k = `${t.date}|${t.type}|${Number(t.amount).toFixed(2)}`; seen[k] = (seen[k] || 0) + 1; });
  out.forEach((t) => { const k = `${t.date}|${t.type}|${t.amount.toFixed(2)}`; if (seen[k] > 0) { seen[k]--; t.dup = true; } t.on = !t.dup; });
  imp.items = out;
}

// ---------- UI ----------
function impLoadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = res; s.onerror = () => rej(new Error("Could not load the Excel reader (needs internet). Save the statement as CSV and try again."));
    document.head.appendChild(s);
  });
}

async function impReadFile(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    await impLoadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" }).map((r) => r.map((c) => String(c).trim()));
  }
  return impParseCSV(await file.text());
}

function openImport() {
  document.getElementById("impModal")?.remove();
  imp = { rows: [], headerIdx: 0, map: {}, noSign: "expense", items: [], file: "" };
  const m = document.createElement("div");
  m.id = "impModal"; m.className = "modal";
  m.innerHTML = `<div class="modal-box card imp-box">
    <div class="card-title"><h3>Import statement</h3><button type="button" class="del" data-x title="Close">✕</button></div>
    <div id="impBody"></div></div>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener("keydown", onKey); imp = null; };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  m.addEventListener("mousedown", (e) => { if (e.target === m) close(); });
  m.querySelector("[data-x]").onclick = close;
  imp.close = close;
  impStep1();
}

function impStep1() {
  const b = document.getElementById("impBody");
  b.innerHTML = `<label class="impdrop" id="impDrop">
      <b>Drop a bank or card statement here</b><span class="muted">or click to choose · CSV, XLSX or XLS</span>
      <input type="file" id="impFile" accept=".csv,.txt,.xlsx,.xls" hidden></label>
    <p class="muted sm">Works with most Indian bank and card statements: date, description, and either debit/credit columns or a single amount column. Dates are read as day/month/year. Nothing is uploaded anywhere. The file is read in your browser.</p>
    <p class="bad sm" id="impErr"></p>`;
  const drop = document.getElementById("impDrop"), inp = document.getElementById("impFile");
  const go = async (f) => {
    if (!f) return;
    try {
      imp.file = f.name; imp.rows = await impReadFile(f);
      imp.headerIdx = impFindHeader(imp.rows);
      imp.map = impDetect(imp.rows[imp.headerIdx] || []);
      impBuild(); impStep2();
    } catch (e) { document.getElementById("impErr").textContent = e.message || "Could not read that file."; }
  };
  inp.onchange = () => go(inp.files[0]);
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => go(e.dataTransfer.files[0]));
}

function impStep2() {
  const b = document.getElementById("impBody");
  const head = imp.rows[imp.headerIdx] || [];
  const sel = (k, label) => `<label>${label}<select data-map="${k}"><option value="-1">— none —</option>${head.map((h, i) => `<option value="${i}"${imp.map[k] === i ? " selected" : ""}>${esc(h || "Column " + (i + 1))}</option>`).join("")}</select></label>`;
  const items = imp.items, on = items.filter((t) => t.on), dups = items.filter((t) => t.dup).length;
  const sum = (a, ty) => a.filter((t) => t.type === ty).reduce((s, t) => s + t.amount, 0);
  const shown = items.slice(0, 500);
  b.innerHTML = `
    <p class="muted sm">${esc(imp.file)} · ${items.length} transaction${items.length === 1 ? "" : "s"} found${dups ? ` · <b>${dups} already in your ledger</b> (unticked)` : ""}</p>
    <details class="impmap"${items.length ? "" : " open"}><summary>Column mapping</summary>
      <div class="modal-grid imp-grid">${sel("date", "Date")}${sel("desc", "Description")}${sel("debit", "Debit / Withdrawal")}${sel("credit", "Credit / Deposit")}${sel("amount", "Amount (single column)")}${sel("drcr", "Dr/Cr or Type column")}
      <label>Unsigned amounts are<select id="impNoSign"><option value="expense"${imp.noSign === "expense" ? " selected" : ""}>Expenses</option><option value="income"${imp.noSign === "income" ? " selected" : ""}>Income</option></select></label></div>
    </details>
    ${items.length ? `<div class="scroll impscroll"><table class="imptable"><thead><tr><th><input type="checkbox" id="impAll" ${on.length === items.length ? "checked" : ""}></th><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>${shown.map((t, i) => `<tr class="${t.dup ? "dup" : ""}"><td><input type="checkbox" data-on="${i}" ${t.on ? "checked" : ""}></td><td>${esc(t.date)}</td>
        <td><select data-ty="${i}"><option${t.type === "expense" ? " selected" : ""}>expense</option><option${t.type === "income" ? " selected" : ""}>income</option></select></td>
        <td><select data-cat="${i}">${opts(t.type === "income" ? INCOME_CATS : EXPENSE_CATS, t.category)}</select></td>
        <td class="impdesc" title="${esc(t.note)}">${esc(t.note)}${t.dup ? ' <span class="pill">duplicate</span>' : ""}</td>
        <td class="num ${t.type === "income" ? "good" : "bad"}">${t.type === "income" ? "+" : "−"}${fmt(t.amount)}</td></tr>`).join("")}</tbody></table></div>
      ${items.length > shown.length ? `<p class="muted sm">Showing the first ${shown.length} rows; all ${items.length} are imported.</p>` : ""}`
    : `<p class="bad">No transactions recognised. Check the column mapping above (a Date column and a Debit/Credit or Amount column are needed).</p>`}
    <div class="modal-acts"><span class="muted sm" id="impSum">${on.length} selected · Income <b class="good">${fmt(sum(on, "income"))}</b> · Expenses <b class="bad">${fmt(sum(on, "expense"))}</b></span>
      <button type="button" class="ghost" id="impBack">Choose another file</button><button type="button" class="primary" id="impGo" ${on.length ? "" : "disabled"}>Import ${on.length}</button></div>`;
  const rerender = () => impStep2();
  b.querySelectorAll("[data-map]").forEach((s) => (s.onchange = () => { imp.map[s.dataset.map] = Number(s.value); impBuild(); rerender(); }));
  const ns = document.getElementById("impNoSign"); ns.onchange = () => { imp.noSign = ns.value; impBuild(); rerender(); };
  const upd = () => {
    const o = imp.items.filter((t) => t.on);
    document.getElementById("impSum").innerHTML = `${o.length} selected · Income <b class="good">${fmt(sum(o, "income"))}</b> · Expenses <b class="bad">${fmt(sum(o, "expense"))}</b>`;
    const g = document.getElementById("impGo"); g.textContent = `Import ${o.length}`; g.disabled = !o.length;
    const all = document.getElementById("impAll"); if (all) all.checked = o.length === imp.items.length;
  };
  b.querySelectorAll("[data-on]").forEach((c) => (c.onchange = () => { imp.items[c.dataset.on].on = c.checked; upd(); }));
  b.querySelectorAll("[data-cat]").forEach((c) => (c.onchange = () => { imp.items[c.dataset.cat].category = c.value; }));
  b.querySelectorAll("[data-ty]").forEach((c) => (c.onchange = () => {
    const t = imp.items[c.dataset.ty]; t.type = c.value; t.category = impGuess(t.note, t.type); rerender();
  }));
  const all = document.getElementById("impAll"); if (all) all.onchange = () => { imp.items.forEach((t) => (t.on = all.checked)); rerender(); };
  document.getElementById("impBack").onclick = () => impStep1();
  document.getElementById("impGo").onclick = impCommit;
}

async function impCommit() {
  const rows = imp.items.filter((t) => t.on).map(({ date, type, amount, note, category }) => ({ date, type, amount, note, category }));
  if (!rows.length) return;
  const btn = document.getElementById("impGo"); btn.disabled = true; btn.textContent = "Importing…";
  try {
    if (mode === "demo") {
      rows.forEach((r) => data.transactions.push({ id: uid(), ...r })); saveLocal(); emit();
    } else {
      for (let i = 0; i < rows.length; i += 25) await Promise.all(rows.slice(i, i + 25).map((r) => add("transactions", r)));
    }
    const n = rows.length; imp.close();
    const t = document.createElement("div"); t.className = "imptoast"; t.textContent = `Imported ${n} transaction${n === 1 ? "" : "s"}`;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
  } catch (e) {
    btn.disabled = false; btn.textContent = "Retry import";
    const er = document.createElement("p"); er.className = "bad sm"; er.textContent = "Import failed: " + (e.message || e); btn.parentElement.before(er);
  }
}
window.openImport = openImport;
