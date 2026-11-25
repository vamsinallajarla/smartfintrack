/**
 * SmartFinTrack SMS inbox (Google Apps Script web app)
 * Receives a bank SMS from your phone and stores the raw text in your Firestore (users/<UID>/inbox).
 * The app reads and classifies it. Nothing is parsed here, so you rarely need to redeploy this.
 *
 * Script properties (Project Settings > Script properties), never put these in code:
 *   TOKEN       long random secret, also pasted into the iPhone Shortcut
 *   PROJECT_ID  your Firebase project id
 *   UID         your Firebase user id (Firebase console > Authentication > Users)
 *   SA_KEY      the full JSON of a service-account key (role: Cloud Datastore User)
 */
function doGet() { return ContentService.createTextOutput("SmartFinTrack SMS inbox is running"); }

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = e.parameter || {}; }
  if (!body.token || body.token !== props.getProperty("TOKEN")) return out_("unauthorized");
  const text = String(body.text || "").trim().slice(0, 1000);
  if (!text) return out_("empty");
  const id = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text).map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
  const url = "https://firestore.googleapis.com/v1/projects/" + props.getProperty("PROJECT_ID") + "/databases/(default)/documents/users/" + props.getProperty("UID") + "/inbox?documentId=" + id;
  const res = UrlFetchApp.fetch(url, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + accessToken_() },
    payload: JSON.stringify({ fields: { text: { stringValue: text }, at: { stringValue: new Date().toISOString() }, src: { stringValue: "sms" } } })
  });
  const code = res.getResponseCode();
  return out_(code === 200 || code === 409 ? "ok" : "error " + code); // 409 = same SMS already stored
}

function out_(s) { return ContentService.createTextOutput(s); }

function accessToken_() {
  const cache = CacheService.getScriptCache(), hit = cache.get("tok");
  if (hit) return hit;
  const sa = JSON.parse(PropertiesService.getScriptProperties().getProperty("SA_KEY"));
  const now = Math.floor(Date.now() / 1000);
  const enc = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ""); };
  const head = enc({ alg: "RS256", typ: "JWT" });
  const claim = enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(head + "." + claim, sa.private_key)).replace(/=+$/, "");
  const r = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", { method: "post", payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + sig } });
  const tok = JSON.parse(r.getContentText()).access_token;
  cache.put("tok", tok, 3000);
  return tok;
}
