# SmartFinTrack

Personal finance dashboard: income, expenses, budgets, investments, net worth.
Plain HTML/JS, Chart.js, optional Firebase (Auth + Firestore).

## Run locally
ES modules need a local server (opening index.html directly won't work):

    python -m http.server 8000
    # or: npx serve

Then open http://localhost:8000

## Demo mode
While `js/firebase-config.js` has placeholder values, the app uses sample data stored in your browser.

## Connect Firebase
1. Firebase Console: create a project, add a Web app, copy the config into `js/firebase-config.js`.
2. Authentication: enable the Google provider.
3. Firestore Database: create a database, then publish the rules in `firestore.rules`.
4. Reload the app and sign in with Google. Data is stored under `users/{uid}/...`.

The web config is not a secret; the Firestore rules are what protect your data.
