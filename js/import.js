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

let imp = null; // current import session: { files:[{name,label,rows,headerIdx,map,noSign,items,err}], items:[] }

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

function impBuildFile(f) {
  const { rows, headerIdx, map, noSign } = f;
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
    out.push({ date, type, dir: type === "income" ? "in" : "out", amount: Math.round(amt * 100) / 100, note, category: impGuess(note, type), account: f.label, file: f });
  }
  f.items = out;
}

// own-account transfers. Flagged when: (1) the description holds an identifier of one of "my accounts" (Net worth) other than
// the statement's own account, (2) an expense in one account is matched by an income of the same amount (±3 days) in another,
// or (3) the wording says self / own account / card bill / FD-RD closure.
const IMP_XFER_RE = /\b(self|own a\/?c|own account|a\/c transfer|acct transfer|fund transfer|trf to self|transfer to self|credit card (bill )?pay|cc pay|ccpay|billdesk.*card|to savings|from savings|sweep|rd instal|fd (creat|clos|mat)|closure proceeds|maturity proceeds|premature closure|(fd|rd|deposit) (closure|maturity|booking|opening))/i;
const impAmt = (t) => Math.round(Number(t.amount) * 100);
function impOwn() {
  const out = [];
  (data.accounts || []).forEach((a) => String(a.match || "").split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3)
    .forEach((id) => out.push({ id, name: String(a.name || ""), loan: a.role === "Loan" || a.kind === "liability" })));
  (data.accounts || []).forEach((a) => String(a.phone || "").split(/[,;\n]/).map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10)
    .forEach((id) => out.push({ id, name: String(a.name || ""), phone: true, loan: false })));
  (data.cards || []).forEach((c) => { if (c.last4) out.push({ id: String(c.last4), name: c.name || "", card: true }); });
  return out;
}
function impXferCat(t, peer) {
  const n = String(t.note || "").toLowerCase();
  if (peer && peer.card || /credit card|cc pay|ccpay|billdesk.*card/.test(n)) return "Card bill";
  if (peer && peer.loan) return "Loan repayment";
  if (/\b(fd|rd|deposit|closure|maturity|sweep)\b/.test(n)) return "FD / RD";
  return "Own account";
}
function impMarkTransfers(all) {
  const own = impOwn();
  all.forEach((t) => {
    t.xfer = ""; t.xcat = "";
    const n = String(t.note || "").toLowerCase(), acc = String(t.account || "").toLowerCase();
    const hit = own.find((o) => o.phone ? new RegExp("(?<!\\d)(?:\\+?91[\\s-]?)?" + o.id + "(?!\\d)").test(t.note || "") : n.includes(o.id) && o.name.toLowerCase() !== acc && (!o.card || /card|cc|bill|payment/.test(n)));
    if (hit) { t.xfer = "own"; t.xcat = impXferCat(t, hit); }
    else if (IMP_XFER_RE.test(t.note)) { t.xfer = "keyword"; t.xcat = impXferCat(t, null); }
  });
  const grp = (t) => t.file || t.account || "";
  const day = (d) => Date.parse(d + "T00:00:00Z") / 864e5;
  const inc = all.filter((t) => t.type === "income" || (t.type === "transfer" && t.dir === "in"));
  const used = new Set();
  all.filter((t) => t.dir !== "in").forEach((e) => {
    const m = inc.find((i) => !used.has(i) && grp(i) && grp(e) && grp(i) !== grp(e) && impAmt(i) === impAmt(e) && Math.abs(day(i.date) - day(e.date)) <= 3);
    if (m) { used.add(m); e.xfer = m.xfer = e.xfer || "paired"; m.xfer = m.xfer || "paired"; e.xcat = e.xcat || impXferCat(e, null); m.xcat = m.xcat || impXferCat(m, null); }
  });
  impMarkOtherCredits(all);
}

// salary is the only income source: every other credit (friends/family, refunds, cashback) is kept out of income
const IMP_SALARY_RE = /\b(salary|sal|payroll|salcr|sal cr|sal credit)\b|salary/i;
const IMP_INTEREST_RE = /\b(int\.?\s?pd|interest (paid|credit)|int pd|credit interest)\b/i;
function impIsSalary(t) {
  if (t.category === "Salary" || IMP_SALARY_RE.test(t.note || "")) return true;
  const n = String(t.note || "").toLowerCase();
  return (data.accounts || []).some((a) => String(a.employer || "").split(/[,;]/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3).some((x) => n.includes(x)));
}
function impNonSalaryCat(t) {
  const n = String(t.note || "").toLowerCase();
  if (/refund|reversal|refd|chargeback|returned/.test(n)) return "Refund";
  if (/cashback|cash back|reward/.test(n)) return "Cashback";
  return "From friends/family";
}
function impMarkOtherCredits(all) {
  all.forEach((t) => {
    if (t.xfer || t.dir !== "in" || (t.type !== "income" && t.type !== "transfer")) return;
    if (impIsSalary(t) || IMP_INTEREST_RE.test(t.note || "")) return;
    t.xfer = "other"; t.xcat = impNonSalaryCat(t);
  });
}

// merge every file's rows; flag rows already in the ledger (date + type + amount), honouring multiplicity
function impMerge() {
  const all = imp.files.flatMap((f) => f.items);
  const seen = {};
  data.transactions.forEach((t) => { const k = `${t.date}|${t.dir || (t.type === "income" ? "in" : "out")}|${Number(t.amount).toFixed(2)}`; seen[k] = (seen[k] || 0) + 1; });
  const key = (t) => `${t.date}|${t.dir}|${t.amount.toFixed(2)}`;
  all.filter((t) => t.checked && t.dup).forEach((t) => { if (seen[key(t)] > 0) seen[key(t)]--; });
  impMarkTransfers(all);
  all.filter((t) => !t.checked).forEach((t) => {
    t.checked = true;
    if (seen[key(t)] > 0) { seen[key(t)]--; t.dup = true; } else t.dup = false;
    t.on = !t.dup;
  });
  all.forEach((t) => { // flagged rows become Transfers (own calculation) unless the user changed the type by hand
    if (t.touched) return;
    if (t.xfer && t.type !== "transfer") { t.type = "transfer"; t.category = t.xcat; t.auto = true; }
    else if (t.xfer && t.auto) t.category = t.xcat;
    else if (!t.xfer && t.auto) { t.type = t.dir === "in" ? "income" : "expense"; t.category = impGuess(t.note, t.type); t.auto = false; }
  });
  imp.items = all.sort((a, b) => b.date.localeCompare(a.date));
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


// ---------- PDF statements (text-based PDFs; scanned images are not supported) ----------
const PDFJS_VER = "3.11.174";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/`;
async function impLoadPDFJS() {
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc) return;
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = PDFJS_BASE + "pdf.min.js"; s.onload = res;
      s.onerror = () => rej(new Error("Could not load the PDF reader (needs internet). Download the statement as CSV/Excel instead."));
      document.head.appendChild(s);
    });
  }
  // load the worker through a blob so it also works when the page is opened from a file
  const code = await (await fetch(PDFJS_BASE + "pdf.worker.min.js")).text();
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
}

const IMP_DATE_START = /^\s*(?:\d{1,5}\s+)?(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}[\s\-]+[A-Za-z]{3,9}[\s\-,]+\d{2,4})(?=\s|$)/;
const IMP_AMT = /^\(?-?₹?(?:Rs\.?)?\s?\d[\d,]*\.\d{2}\)?(?:\s?(?:Cr|Dr|CR|DR))?$/;

async function impReadPdf(file) {
  await impLoadPDFJS();
  const buf = await file.arrayBuffer();
  let pdf, pwd;
  for (let tries = 0; ; tries++) {
    try { pdf = await pdfjsLib.getDocument({ data: buf.slice(0), password: pwd }).promise; break; }
    catch (e) {
      if (e && e.name === "PasswordException" && tries < 3) {
        pwd = window.prompt(`${file.name} is password protected. Enter the password (often your customer ID, date of birth or PAN):`);
        if (pwd == null) throw new Error("password needed");
      } else if (e && e.name === "PasswordException") throw new Error("wrong password");
      else throw new Error("not a readable PDF");
    }
  }
  const out = [["Date", "Description", "Withdrawal", "Deposit", "Amount", "Dr/Cr"]];
  let cols = null, prevBal = null, last = null, textChars = 0;
  const dump = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width || i.str.length * 5 }));
    textChars += items.reduce((n, i) => n + i.s.length, 0);
    const lines = [];
    items.sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
      const ln = lines.find((l) => Math.abs(l.y - it.y) <= 3);
      if (ln) ln.t.push(it); else lines.push({ y: it.y, t: [it] });
    });
    for (const ln of lines) {
      ln.t.sort((a, b) => a.x - b.x);
      const text = ln.t.map((t) => t.s).join(" ");
      const low = text.toLowerCase();
      if (dump.length < 40) dump.push(text.slice(0, 160));
      // header line: remember where the debit / credit / balance columns sit
      if (/(withdraw|debit|paid out)/.test(low) && /(deposit|credit|paid in)/.test(low)) {
        // PDF text items can be merged ("Deposit Amount Balance"), so position every character along the line
        const chars = [];
        ln.t.forEach((t) => { for (let i = 0; i < t.s.length; i++) chars.push({ ch: t.s[i], x: t.x + (t.w * i) / t.s.length }); chars.push({ ch: " ", x: t.x + t.w }); });
        const str = chars.map((c) => c.ch).join("").toLowerCase();
        const found = [["d", str.search(/withdraw|debit|paid out/)], ["c", str.search(/deposit|credit|paid in/)], ["b", str.search(/balance/)]]
          .filter((k) => k[1] >= 0).sort((a, b) => a[1] - b[1]);
        const c = {};
        found.forEach((k, i) => {
          const start = chars[k[1]].x, end = i + 1 < found.length ? chars[found[i + 1][1]].x : chars[chars.length - 1].x;
          c[k[0]] = (start + end) / 2;
        });
        if (c.d != null && c.c != null) { cols = c; continue; }
      }
      const dm = text.match(IMP_DATE_START);
      const amts = ln.t.filter((t) => IMP_AMT.test(t.s));
      if (dm) {
        if (!amts.length) { last = { date: dm[1], desc: text.slice(dm[0].length).trim(), cells: [] }; out.push(null); out[out.length - 1] = last.row = [dm[1], last.desc, "", "", "", ""]; continue; }
        const descToks = ln.t.filter((t) => !IMP_AMT.test(t.s));
        let desc = descToks.map((t) => t.s).join(" ").slice(dm[0].length).trim();
        const clean = desc.split(/\s+/).filter((w) => !/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(w) && !/^\d{6,}$/.test(w) && w !== "-").join(" "); // drop value date + cheque/ref numbers
        if (clean) desc = clean;
        const row = [dm[1], desc, "", "", "", ""];
        const val = (t) => t.s.replace(/[^\d.]/g, "");
        const nums = amts.map((t) => ({ v: parseFloat(val(t)), cr: /cr$/i.test(t.s), dr: /dr$/i.test(t.s), neg: /^\(|^-/.test(t.s) }));
        let done = false;
        if (nums.length >= 2 && prevBal != null) { // last amount = running balance: its change tells money in vs out
          const bal = nums[nums.length - 1].v, tx = nums.slice(0, -1).reduce((a, n) => a + n.v, 0);
          if (tx > 0 && Math.abs(prevBal + tx - bal) < 0.02) { row[3] = String(tx); done = true; }
          else if (tx > 0 && Math.abs(prevBal - tx - bal) < 0.02) { row[2] = String(tx); done = true; }
        }
        if (!done && cols) {
          const colsX = [["d", cols.d], ["c", cols.c], ["b", cols.b]].filter((k) => k[1] != null);
          amts.forEach((t) => {
            const m = t.x + t.w / 2, best = colsX.reduce((a, b) => (Math.abs(b[1] - m) < Math.abs(a[1] - m) ? b : a));
            if (best[0] === "d") row[2] = val(t); else if (best[0] === "c") row[3] = val(t);
          });
          done = true;
        }
        if (!done) {
          if (nums.length >= 2) { row[4] = String(nums[nums.length - 2].v); row[5] = ""; }
          else { const n = nums[0]; row[4] = String(n.neg ? -n.v : n.v); if (n.cr) row[5] = "CR"; else if (n.dr) row[5] = "DR"; }
        }
        if (nums.length >= 2) prevBal = nums[nums.length - 1].v;
        out.push(row); last = { row };
      } else if (last && last.row && !amts.length && ln.t.length && !/page \d|statement|opening balance|closing balance|total/i.test(low) && last.row[1].length < 100) {
        last.row[1] = (last.row[1] + " " + text).replace(/\s+/g, " ").trim(); // narration continues on the next line
      }
    }
  }
  const fail = (m) => { const e = new Error(m); e.dump = dump.join("\n"); return e; };
  if (textChars < 40) throw fail("no selectable text found (scanned PDF). Download CSV/Excel from net banking instead.");
  // rows where only the balance moved the other way are unknown: treat as unsigned amount
  out.forEach((r) => { if (r[5] === "?") r[5] = ""; });
  if (out.length < 2) throw fail("no transaction rows recognised. Try the CSV/Excel download from net banking, or send the text below so the reader can be adjusted.");
  return out;
}

async function impReadFile(file) {
  if (/\.pdf$/i.test(file.name)) return impReadPdf(file);
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
  imp = { files: [], items: [] };
  const m = document.createElement("div");
  m.id = "impModal"; m.className = "modal";
  m.innerHTML = `<div class="modal-box card imp-box">
    <div class="card-title"><h3>Import statements</h3><button type="button" class="del" data-x title="Close">✕</button></div>
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

async function impAddFiles(list, errEl) {
  const errs = [];
  for (const file of Array.from(list)) {
    if (imp.files.some((f) => f.name === file.name && f.size === file.size)) continue;
    try {
      const rows = await impReadFile(file);
      const f = { name: file.name, size: file.size, label: file.name.replace(/\.[^.]+$/, ""), rows, headerIdx: 0, map: {}, noSign: "expense", items: [] };
      f.headerIdx = impFindHeader(rows); f.map = impDetect(rows[f.headerIdx] || []);
      impBuildFile(f); imp.files.push(f);
    } catch (e) { errs.push({ name: file.name, msg: e.message || "could not be read", dump: e.dump }); }
  }
  impMerge();
  if (errs.length && errEl) {
    errEl.innerHTML = errs.map((x) => `<div><b>${esc(x.name)}</b>: ${esc(x.msg)}${x.dump ? `<details><summary>Show the text read from this PDF</summary><pre class="impdump">${esc(x.dump)}</pre><span class="muted sm">Blank out names and account numbers before sharing.</span></details>` : ""}</div>`).join("");
  }
  return errs;
}

function impStep1() {
  const b = document.getElementById("impBody");
  b.innerHTML = `<label class="impdrop" id="impDrop">
      <b>Drop one or more bank / card statements here</b><span class="muted">select several files at once, one per account · CSV, XLSX, XLS or text-based PDF</span>
      <input type="file" id="impFile" accept=".csv,.txt,.xlsx,.xls,.pdf" multiple hidden></label>
    <p class="muted sm">Each file is read separately, so different banks and layouts can be imported together. Dates are read as day/month/year. Nothing is uploaded anywhere; files are read in your browser.</p>
    <p class="bad sm" id="impErr"></p>`;
  const drop = document.getElementById("impDrop"), inp = document.getElementById("impFile"), err = document.getElementById("impErr");
  const go = async (files) => { if (!files || !files.length) return; await impAddFiles(files, err); if (imp.files.length) impStep2(); };
  inp.onchange = () => go(inp.files);
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => go(e.dataTransfer.files));
}

function impStep2() {
  const b = document.getElementById("impBody");
  const items = imp.items, on = items.filter((t) => t.on), dups = items.filter((t) => t.dup).length, nx = items.filter((t) => t.type === "transfer").length;
  const sum = (a, ty) => a.filter((t) => t.type === ty).reduce((s, t) => s + t.amount, 0);
  const shown = items.slice(0, 500);
  const multi = imp.files.length > 1;
  const mapSel = (fi, f, k, label) => `<label>${label}<select data-fi="${fi}" data-map="${k}"><option value="-1">— none —</option>${(f.rows[f.headerIdx] || []).map((h, i) => `<option value="${i}"${f.map[k] === i ? " selected" : ""}>${esc(h || "Column " + (i + 1))}</option>`).join("")}</select></label>`;
  b.innerHTML = `
    <div class="impfiles">${imp.files.map((f, fi) => `
      <details class="impfile"${f.items.length ? "" : " open"}>
        <summary><b>${esc(f.name)}</b> · ${f.items.length} row${f.items.length === 1 ? "" : "s"}${f.items.length ? "" : ' <span class="bad">— check mapping</span>'}
          <span class="impacct">Account <input data-label="${fi}" value="${esc(f.label)}" maxlength="40" list="impAccts" title="Pick one of your accounts (Net worth) or type a label; saved on each transaction from this file"></span>
          <button type="button" class="del" data-rmfile="${fi}" title="Remove this file">✕</button></summary>
        <div class="modal-grid imp-grid">${mapSel(fi, f, "date", "Date")}${mapSel(fi, f, "desc", "Description")}${mapSel(fi, f, "debit", "Debit / Withdrawal")}${mapSel(fi, f, "credit", "Credit / Deposit")}${mapSel(fi, f, "amount", "Amount (single column)")}${mapSel(fi, f, "drcr", "Dr/Cr or Type column")}
        <label>Unsigned amounts are<select data-fi="${fi}" data-nosign><option value="expense"${f.noSign === "expense" ? " selected" : ""}>Expenses</option><option value="income"${f.noSign === "income" ? " selected" : ""}>Income</option></select></label></div>
      </details>`).join("")}
      <button type="button" class="ghost sm" id="impMore">+ Add more files</button><input type="file" id="impMoreIn" accept=".csv,.txt,.xlsx,.xls,.pdf" multiple hidden>
    </div>
    <p class="muted sm">${items.length} transaction${items.length === 1 ? "" : "s"} from ${imp.files.length} file${imp.files.length === 1 ? "" : "s"}${dups ? ` · <b>${dups} already in your ledger</b> (unticked)` : ""}${nx ? ` · <b>${nx} own-account transfer${nx === 1 ? "" : "s"}</b> (kept out of income &amp; expenses; change Type to override)` : ""}</p>
    <datalist id="impAccts">${(data.accounts || []).map((a) => `<option value="${esc(a.name)}">`).join("")}</datalist>
    ${items.length ? `<div class="scroll impscroll"><table class="imptable"><thead><tr><th><input type="checkbox" id="impAll" ${on.length === items.length ? "checked" : ""}></th><th>Date</th>${multi ? "<th>Account</th>" : ""}<th>Type</th><th>Category</th><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>${shown.map((t, i) => `<tr class="${t.dup ? "dup" : ""}"><td><input type="checkbox" data-on="${i}" ${t.on ? "checked" : ""}></td><td>${esc(t.date)}</td>${multi ? `<td class="muted">${esc(t.account)}</td>` : ""}
        <td><select data-ty="${i}"><option${t.type === "expense" ? " selected" : ""}>expense</option><option${t.type === "income" ? " selected" : ""}>income</option><option${t.type === "transfer" ? " selected" : ""}>transfer</option></select></td>
        <td><select data-cat="${i}">${opts(t.type === "income" ? INCOME_CATS : t.type === "transfer" ? XFER_CATS : EXPENSE_CATS, t.category)}</select></td>
        <td class="impdesc" title="${esc(t.note)}">${esc(t.note)}${t.dup ? ' <span class="pill">duplicate</span>' : ""}${t.type === "transfer" ? ` <span class="pill" title="${t.xfer === "paired" ? "Matching entry in another imported account" : t.xfer === "own" ? "Mentions one of your accounts" : t.xfer === "other" ? "Credit that is not salary" : t.xfer ? "Wording looks like a transfer" : "Marked as transfer"}">transfer</span>` : ""}</td>
        <td class="num ${txCls(t)}">${t.type === "transfer" ? (t.dir === "in" ? "⇄ in " : "⇄ out ") + fmt(t.amount) : txAmt(t)}</td></tr>`).join("")}</tbody></table></div>
      ${items.length > shown.length ? `<p class="muted sm">Showing the first ${shown.length} rows; all ${items.length} are imported.</p>` : ""}`
    : `<p class="bad">No transactions recognised yet. Open a file above and check its column mapping (a Date column and a Debit/Credit or Amount column are needed).</p>`}
    <div class="modal-acts"><span class="muted sm" id="impSum">${on.length} selected · Income <b class="good">${fmt(sum(on, "income"))}</b> · Expenses <b class="bad">${fmt(sum(on, "expense"))}</b> · Transfers ⇄ <b>${fmt(sum(on, "transfer"))}</b></span>
      <button type="button" class="primary" id="impGo" ${on.length ? "" : "disabled"}>Import ${on.length}</button></div>`;
  const rebuild = (fi) => { const f = imp.files[fi]; f.items.forEach((t) => (t.checked = false)); impBuildFile(f); impMerge(); impStep2(); };
  b.querySelectorAll("[data-map]").forEach((s) => (s.onchange = () => { const f = imp.files[s.dataset.fi]; f.map[s.dataset.map] = Number(s.value); rebuild(s.dataset.fi); }));
  b.querySelectorAll("[data-nosign]").forEach((s) => (s.onchange = () => { imp.files[s.dataset.fi].noSign = s.value; rebuild(s.dataset.fi); }));
  b.querySelectorAll("[data-label]").forEach((i) => {
    i.onclick = (e) => e.stopPropagation(); i.onkeydown = (e) => e.stopPropagation();
    i.onchange = () => { const f = imp.files[i.dataset.label]; f.label = i.value.trim() || f.name; f.items.forEach((t) => (t.account = f.label)); impMerge(); impStep2(); };
  });
  b.querySelectorAll("[data-rmfile]").forEach((x) => (x.onclick = (e) => {
    e.preventDefault(); e.stopPropagation(); imp.files.splice(Number(x.dataset.rmfile), 1); impMerge();
    if (imp.files.length) impStep2(); else impStep1();
  }));
  document.getElementById("impMore").onclick = () => document.getElementById("impMoreIn").click();
  document.getElementById("impMoreIn").onchange = async (e) => { await impAddFiles(e.target.files); impStep2(); };
  const upd = () => {
    const o = imp.items.filter((t) => t.on);
    document.getElementById("impSum").innerHTML = `${o.length} selected · Income <b class="good">${fmt(sum(o, "income"))}</b> · Expenses <b class="bad">${fmt(sum(o, "expense"))}</b> · Transfers ⇄ <b>${fmt(sum(o, "transfer"))}</b>`;
    const g = document.getElementById("impGo"); g.textContent = `Import ${o.length}`; g.disabled = !o.length;
    const all = document.getElementById("impAll"); if (all) all.checked = o.length === imp.items.length;
  };
  b.querySelectorAll("[data-on]").forEach((c) => (c.onchange = () => { imp.items[c.dataset.on].on = c.checked; upd(); }));
  b.querySelectorAll("[data-cat]").forEach((c) => (c.onchange = () => { imp.items[c.dataset.cat].category = c.value; }));
  b.querySelectorAll("[data-ty]").forEach((c) => (c.onchange = () => {
    const t = imp.items[c.dataset.ty]; t.type = c.value; t.touched = true; t.auto = false;
    t.category = t.type === "transfer" ? t.xcat || "Own account" : impGuess(t.note, t.type); impStep2();
  }));
  const all = document.getElementById("impAll"); if (all) all.onchange = () => { imp.items.forEach((t) => (t.on = all.checked)); impStep2(); };
  document.getElementById("impGo").onclick = impCommit;
}

async function impCommit() {
  const rows = imp.items.filter((t) => t.on).map(({ date, type, amount, note, category, account, dir }) => ({ date, type, dir, amount, note, category, ...(account ? { account } : {}) }));
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
// convert existing ledger entries that look like own-account transfers
function impScanLedger() {
  const cand = data.transactions.filter((t) => t.type === "income" || t.type === "expense")
    .map((t) => ({ id: t.id, type: t.type, dir: t.type === "income" ? "in" : "out", amount: Number(t.amount) || 0, date: String(t.date), note: String(t.note || ""), account: t.account || "", file: t.account || "" }));
  impMarkTransfers(cand);
  const hits = cand.filter((t) => t.xfer);
  document.getElementById("scanModal")?.remove();
  const m = document.createElement("div"); m.id = "scanModal"; m.className = "modal";
  m.innerHTML = `<div class="modal-box card imp-box"><div class="card-title"><h3>Transfers found in your entries</h3><button type="button" class="del" data-x title="Close">✕</button></div>
    ${hits.length ? `<p class="muted sm">${hits.length} entr${hits.length === 1 ? "y looks" : "ies look"} like own-account transfers. They will move out of income/expenses into Transfers. Untick any that are real.</p>
    <div class="scroll impscroll"><table class="imptable"><tbody>${hits.map((t, i) => `<tr><td><input type="checkbox" data-s="${i}" checked></td><td>${esc(t.date)}</td><td>${esc(t.account)}</td><td class="impdesc" title="${esc(t.note)}">${esc(t.note)}</td><td>${esc(t.xcat)}</td><td class="num">${t.dir === "in" ? "+" : "−"}${fmt(t.amount)}</td></tr>`).join("")}</tbody></table></div>
    <div class="modal-acts"><button type="button" class="ghost" data-x>Cancel</button><button type="button" class="primary" id="scanGo">Convert</button></div>`
    : `<p class="muted">No transfers found. Add your accounts and their identifiers under Net worth, or label statements with the account name when importing, then try again.</p>`}</div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelectorAll("[data-x]").forEach((b) => (b.onclick = close));
  m.addEventListener("mousedown", (e) => { if (e.target === m) close(); });
  const go = document.getElementById("scanGo");
  if (go) go.onclick = async () => {
    go.disabled = true; go.textContent = "Converting…";
    const pick = hits.filter((_, i) => m.querySelector(`[data-s="${i}"]`).checked);
    for (let i = 0; i < pick.length; i += 25) await Promise.all(pick.slice(i, i + 25).map((t) => update("transactions", t.id, { type: "transfer", dir: t.dir, category: t.xcat })));
    close();
  };
}
// bulk-delete imported entries (everything that carries a statement account label), by account
function impClear() {
  const by = {};
  data.transactions.filter((t) => t.account).forEach((t) => (by[t.account] = by[t.account] || []).push(t));
  const names = Object.keys(by);
  document.getElementById("clrModal")?.remove();
  const m = document.createElement("div"); m.id = "clrModal"; m.className = "modal";
  m.innerHTML = `<div class="modal-box card imp-box"><div class="card-title"><h3>Clear imported entries</h3><button type="button" class="del" data-x title="Close">✕</button></div>
    ${names.length ? `<p class="muted sm">Entries imported from statements, grouped by account label. Entries you added by hand are never touched. This cannot be undone.</p>
    <table class="imptable"><tbody>${names.map((n, i) => `<tr><td><input type="checkbox" data-c="${i}" checked></td><td>${esc(n)}</td><td class="num">${by[n].length} entries</td></tr>`).join("")}</tbody></table>
    <div class="modal-acts"><button type="button" class="ghost" data-x>Cancel</button><button type="button" class="primary" id="clrGo">Delete selected</button></div>`
    : `<p class="muted">No imported entries found. Only entries imported from statements carry an account label.</p>`}</div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelectorAll("[data-x]").forEach((b) => (b.onclick = close));
  m.addEventListener("mousedown", (e) => { if (e.target === m) close(); });
  const go = document.getElementById("clrGo");
  if (go) go.onclick = async () => {
    const pick = names.filter((_, i) => m.querySelector(`[data-c="${i}"]`).checked).flatMap((n) => by[n]);
    if (!pick.length || !confirm(`Delete ${pick.length} imported entries permanently?`)) return;
    go.disabled = true; go.textContent = "Deleting…";
    for (let i = 0; i < pick.length; i += 25) await Promise.all(pick.slice(i, i + 25).map((t) => remove("transactions", t.id)));
    close();
  };
}
window.impClear = impClear;
window.impScanLedger = impScanLedger;
window.openImport = openImport;
