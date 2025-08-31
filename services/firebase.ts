import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

// IMPORTANT: Replace with your Firebase project's configuration
const firebaseConfig = {
  apiKey: "AIzaSyDW__u6N742nHgVGEzu6VhwVDrCkEQHvh4",
  authDomain: "storied-epigram-470710-t2.firebaseapp.com",
  projectId: "storied-epigram-470710-t2",
  storageBucket: "storied-epigram-470710-t2.firebasestorage.app",
  messagingSenderId: "852059340429",
  appId: "1:852059340429:web:0e8bb479b7f0b1fbdc6cc4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);

// To use the local Firebase emulators for development, uncomment the lines below.
// 1. Install the Firebase CLI: `npm install -g firebase-tools`
// 2. Initialize Firebase in your project: `firebase init` (select Emulators)
// 3. Start the emulators: `firebase emulators:start`
// const useEmulators = true;
// if (useEmulators) {
//     console.log("Using Firebase Emulators");
//     connectAuthEmulator(auth, "http://localhost:9099");
//     connectFirestoreEmulator(db, "http://localhost:8080");
// }


export { app, auth, db };
