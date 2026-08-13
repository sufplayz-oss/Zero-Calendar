// ── One-time setup ──────────────────────────────────────────────────────
// 1. Go to https://console.firebase.google.com -> "Add project" (free).
// 2. In your new project, click the </> (web) icon to register a web app.
//    It will show you a config object — copy those values into firebaseConfig below.
// 3. Left sidebar -> Build -> Firestore Database -> Create database
//    (any region, start in "production mode").
// 4. Left sidebar -> Build -> Authentication -> Get started -> enable
//    the "Email/Password" sign-in provider.
// 5. Still in Authentication, go to the "Users" tab -> "Add user" and
//    create yourself one email + password. That's what you'll sign in
//    with on both your PC and your phone.
// 6. In Firestore -> Rules, replace the rules with the contents of
//    firestore.rules (in this folder) and click "Publish".
// 7. Replace the placeholder values below with your real config.
// 8. Put this whole folder somewhere your phone can reach it too — the
//    easiest free option is GitHub Pages (see SETUP notes provided in chat).
// ─────────────────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: "AIzaSyBzfXTH15RO-AwCAyVsYL-nXWQGDHS6CBs",
  authDomain: "zero-calendar-cf506.firebaseapp.com",
  projectId: "zero-calendar-cf506",
  storageBucket: "zero-calendar-cf506.firebasestorage.app",
  messagingSenderId: "777159762490",
  appId: "1:777159762490:web:f5acb8862017ca09030b03",
};
