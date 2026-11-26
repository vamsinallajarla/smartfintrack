/* SMS inbox: bank SMS forwarded from the phone land in the `inbox` collection as raw text.
   They are parsed here, classified with the same rules as statement import, and shown for review. */
const SMS_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function smsDate(t, at) {
  let m;
  const mk = (y, mo, d) => { y = Number(y); if (y < 100) y += 2000; return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
  if ((m = t.match(/\b(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{2,4})\b/)) && SMS_MON[m[2].toLowerCase()]) return mk(m[3], SMS_MON[m[2].toLowerCase()], m[1]);
  if ((m = t.match(/\b(\d{1,2})([A-Za-z]{3})(\d{2,4})\b/)) && SMS_MON[m[2].toLowerCase()]) return mk(m[3], SMS_MON[m[2].toLowerCase()], m[1]);
  if ((m = t.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/))) return mk(m[3], m[2], m[1]); // India: dd/mm/yyyy
  const d = at ? new Date(at) : new Date();
  return isNaN(d) ? new Date().toISOString().slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function smsParse(text, at) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || /\b(otp|one[- ]time password|verification code)\b|mandate|autopay|scheduled|cancel+ed|please ensure/i.test(t)) return null;
  const am = t.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) || t.match(/\b(?:debit|credit)(?:ed)?\s+(?:by|with|for)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!am) return null;
  const amount = Number(am[1].replace(/,/g, ""));
  const inIdx = t.search(/\b(credited|credit(?!\s*card)|received|deposited|refund(?:ed)?)\b/i), outIdx = t.search(/\b(debited|debit|sent|spent|withdrawn|paid|purchase|transferred)\b/i);
  if (!(amount > 0) || (inIdx < 0 && outIdx < 0)) return null;
  const dir = inIdx >= 0 && (outIdx < 0 || inIdx < outIdx) ? "in" : "out";
  const bank = /kotak/i.test(t) ? "Kotak" : /axis/i.test(t) ? "Axis" : /\bsbi\b/i.test(t) ? "SBI" : /icici/i.test(t) ? "ICICI" : /hdfc/i.test(t) ? "HDFC" : /\bidfc/i.test(t) ? "IDFC" : "Bank";
  const am2 = t.match(/(?:[Xx*]{1,}|\bXX)(\d{3,4})\b/) || t.match(/\b(?:a\/?c|acct|account)\s*(?:no\.?)?\s*(\d{3,4})\b/i);
  const digits = am2 ? am2[1] : "";
  const own = digits ? (data.accounts || []).find((a) => String(a.match || "").split(/[,;\n]/).some((x) => x.trim().length >= 3 && x.trim().endsWith(digits.slice(-3)))) : null;
  const account = own ? own.name : digits ? `${bank} ••${digits}` : bank;
  const ref = (t.match(/(?:ref(?:erence)?\s*(?:no\.?|#)?\s*:?|UPI:|IMPS Ref#)\s*([A-Za-z0-9\/]*?\d{9,}[A-Za-z0-9\/]*)/i) || [])[1] || (t.match(/\b(\d{10,12})\b/) || [])[1] || "";
  const refNum = (ref.match(/\d{9,}/) || [""])[0];
  const mode = /\bUPI\b/i.test(t) ? "UPI" : /\bIMPS\b/i.test(t) ? "IMPS" : /\bNEFT\b/i.test(t) ? "NEFT" : /\bRTGS\b/i.test(t) ? "RTGS" : /\bATM\b/i.test(t) ? "ATM" : /\bcard\b/i.test(t) ? "Card" : "Bank";
  let cp = "", m;
  if ((m = t.match(/\btrf to\s+(.+?)\s+ref/i))) cp = m[1];
  else if (dir === "out" && (m = t.match(/\bto\s+(.+?)\s+on\s+\d/i))) cp = m[1];
  else if (dir === "in" && (m = t.match(/\bfrom\s+(.+?)\s+(?:in your|on\s+\d)/i))) cp = m[1];
  else if ((m = t.match(/;\s*(.+?)\s+(?:credited|debited)\b/i))) cp = m[1];
  else if ((m = t.match(/linked to mobile\s+(\S+?)-([A-Za-z ]+?)\s*\(/i))) cp = `mobile ${m[1]} ${m[2]}`;
  else if ((m = t.match(/(?:IMPS|NEFT|UPI)\/[A-Za-z0-9]+\/\d+\/(\S+)/i))) cp = m[1];
  else if ((m = t.match(/\bat\s+([A-Za-z0-9 .&'-]{3,30}?)\s+(?:on|using|via)\b/i))) cp = m[1];
  cp = cp.replace(/\s+/g, " ").trim();
  const rev = /reversal|refund/i.test(t);
  const note = rev ? `${mode} reversal of txn${refNum ? " · ref " + refNum : ""}` : `${mode} ${dir === "in" ? "from" : "to"} ${cp || "unknown"}${refNum ? " · ref " + refNum : ""}`;
  return { date: smsDate(t, at), type: dir === "in" ? "income" : "expense", dir, amount, note, account, file: account, category: "Other", ref: refNum, raw: t };
}
// classify like a statement import: own accounts / phone numbers / salary vs other credits
function smsClassify(rows) {
  impMarkTransfers(rows);
  rows.forEach((r) => {
    if (r.xfer) { r.type = "transfer"; r.category = r.xcat; }
    else r.category = impGuess(r.note, r.type);
  });
  return rows;
}
function smsPending() {
  const items = (data.inbox || []).slice().sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const parsed = [], bad = [];
  items.forEach((it) => { const r = smsParse(it.text, it.at); if (r) { r.id = it.id; parsed.push(r); } else bad.push(it); });
  smsClassify(parsed);
  parsed.forEach((r) => { r.dup = r.ref && data.transactions.some((t) => String(t.note || "").includes(r.ref)); });
  return { parsed, bad };
}
window.smsCard = function () {
  if (!(data.inbox || []).length) return "";
  const { parsed, bad } = smsPending();
  const cats = (ty) => (ty === "income" ? INCOME_CATS : ty === "transfer" ? XFER_CATS : EXPENSE_CATS);
  return `<div class="card smsbox" id="smsBox"><h2 class="h2row">Pending from SMS (${parsed.length + bad.length}) <span><button type="button" class="ghost sm" id="smsAll">Accept all</button> <button type="button" class="ghost sm" id="smsIgnoreAll">Ignore all</button></span></h2>
    <p class="muted sm">Read from your bank SMS. Own-account, phone-number, salary and refund rules are applied. Check, then accept.</p>
    <div class="scroll"><table><thead><tr><th></th><th>Date</th><th>Account</th><th>Details</th><th>Type</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${parsed.map((r) => `<tr data-sid="${esc(r.id)}"><td><input type="checkbox" data-sc${r.dup ? "" : " checked"}></td><td>${esc(r.date)}</td><td>${esc(r.account)}</td><td class="impdesc" title="${esc(r.raw)}">${esc(r.note)}${r.dup ? ' <span class="pill">already in ledger</span>' : ""}</td>
      <td><select data-st>${opts(["expense", "income", "transfer"], r.type)}</select></td><td><select data-sk>${opts(cats(r.type), r.category)}</select></td>
      <td class="num ${r.dir === "in" ? "good" : ""}">${r.dir === "in" ? "+" : "−"}${fmt(r.amount)}</td><td><button class="del" data-sx title="Ignore">✕</button></td></tr>`).join("")}
    ${bad.map((it) => `<tr data-sid="${esc(it.id)}" class="dim"><td></td><td colspan="6" class="impdesc" title="${esc(it.text)}">Not a transaction: ${esc(String(it.text).slice(0, 90))}</td><td><button class="del" data-sx title="Ignore">✕</button></td></tr>`).join("")}
    </tbody></table></div></div>`;
};
window.smsBind = function (root) {
  const box = root.querySelector("#smsBox"); if (!box) return;
  const { parsed } = smsPending(), byId = Object.fromEntries(parsed.map((r) => [r.id, r]));
  const cats = (ty) => (ty === "income" ? INCOME_CATS : ty === "transfer" ? XFER_CATS : EXPENSE_CATS);
  box.querySelectorAll("tr[data-sid]").forEach((tr) => {
    const r = byId[tr.dataset.sid];
    const st = tr.querySelector("[data-st]"), sk = tr.querySelector("[data-sk]");
    if (st) st.onchange = () => { sk.innerHTML = opts(cats(st.value), st.value === "transfer" ? "Own account" : "Other"); };
    tr.querySelector("[data-sx]").onclick = () => remove("inbox", tr.dataset.sid);
  });
  const accept = async (rows) => {
    for (const tr of rows) {
      const r = byId[tr.dataset.sid]; if (!r) continue;
      const type = tr.querySelector("[data-st]").value, category = tr.querySelector("[data-sk]").value;
      await add("transactions", { date: r.date, type, dir: r.dir, amount: r.amount, note: r.note.slice(0, 120), category, account: r.account, src: "sms", raw: String(r.raw || "").slice(0, 300) });
      await remove("inbox", r.id);
    }
  };
  box.querySelector("#smsAll").onclick = () => accept([...box.querySelectorAll("tr[data-sid]")].filter((tr) => tr.querySelector("[data-sc]")?.checked));
  box.querySelector("#smsIgnoreAll").onclick = async () => { if (!confirm("Ignore all pending SMS?")) return; for (const it of data.inbox.slice()) await remove("inbox", it.id); };
};
window.smsParse = smsParse;
