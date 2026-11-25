# Bank SMS to SmartFinTrack (iPhone, free)

How it works: iPhone Shortcut -> your Google Apps Script link -> your Firestore `inbox` -> "Pending from SMS" card on the Ledger page.

## 1. Firebase: read-write key for the script
1. Publish the new `firestore.rules` (Firebase console > Firestore > Rules). It now allows `inbox`.
2. Google Cloud console > IAM & Admin > Service Accounts (project smartfintrac...) > Create service account "sms-inbox".
3. IAM > grant that account the role **Cloud Datastore User**.
4. Service account > Keys > Add key > JSON. Keep the downloaded file private. Never commit it or paste it in chat.
5. Firebase console > Authentication > Users: copy your **User UID**. Project settings: copy the **Project ID**.

## 2. Apps Script
1. script.google.com > New project, paste `apps-script/sms-inbox.gs`.
2. Project Settings > Script properties, add: `TOKEN` (a long random string), `PROJECT_ID`, `UID`, `SA_KEY` (the whole JSON file text).
3. Deploy > New deployment > Web app > Execute as: **Me**, Who has access: **Anyone**. Copy the web app URL.
4. Open the URL in a browser: it should say "SmartFinTrack SMS inbox is running".

## 3. iPhone Shortcut and automations
1. Shortcuts > New shortcut "Send bank SMS": action **Get Contents of URL**: URL = your web app URL, Method POST, Request Body JSON with `token` (your TOKEN) and `text` (the Shortcut Input).
2. Automation tab > + > **Message** > Message contains `Rs` > Run Immediately (turn off Ask Before Running / Notify When Run) > run the shortcut. Repeat for `INR`, `debited`, `credited`.
3. Duplicates are ignored, so overlapping automations are fine.

## 4. Use it
Ledger > "Pending from SMS": check each row (type and category can be changed), then Accept. Add your own name text (for example NALLAJAR) and your phone number to an account under Net worth so your own transfers are recognised.
