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
**A. The shortcut**
1. Shortcuts app > Shortcuts tab > + (new shortcut). Name it **Send bank SMS**.
2. Add action **Get Text from Input** (Input = Shortcut Input).
3. Add action **Get Contents of URL**. URL: your web app URL. Tap **Show More**: Method **POST**, Request Body **JSON**.
4. In the JSON add two Text fields: `token` = your TOKEN, and `text` = the magic variable **Text** (output of step 2).
5. Done. Do not add Show Result.

**B. The automations (one per word)**
1. Automation tab > + > **Message**. Leave Sender empty. Message Contains: `Rs`. Next.
2. Choose **Run Immediately** (not Run After Confirmation). Next.
3. Pick the shortcut **Send bank SMS**. Next. Turn **Notify When Run** off. Done.
4. Repeat for `INR`, `debited`, `credited` (the same SMS arriving twice is stored once).

**C. Test**
Wait for a real bank SMS, or ask a friend to text you "Debit INR 1.00 A/c XX8685 test". Check Apps Script > Executions for a green run, then the Ledger page for "Pending from SMS". If nothing arrives, open the web app URL in Safari (it must say "SmartFinTrack SMS inbox is running"), and check TOKEN matches in the shortcut and the script properties.

## 4. Use it
Ledger > "Pending from SMS": check each row (type and category can be changed), then Accept. Under Net worth > Credit/Debit classification keywords, add your account numbers, name text (for example NALLAJAR) and phone / UPI numbers so your own transfers are recognised.
