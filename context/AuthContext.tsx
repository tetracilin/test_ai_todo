import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    sendPasswordResetEmail, 
    updatePassword,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    User as FirebaseUser 
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { Person, LogAction } from '../types';
import { auth, db } from '../services/firebase';
import { useTasks } from './TaskContext';


interface AuthContextType {
  currentUser: Person | null;
  currentUserId: string | null;
  firebaseUser: FirebaseUser | null;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  isReady: boolean;
  appView: 'main' | 'account-settings';
  showAccountSettings: () => void;
  showMainApp: () => void;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<Person | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [appView, setAppView] = useState<'main' | 'account-settings'>('main');
  const { addLogEntry, upsertPerson } = useTasks();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        setCurrentUserId(user.uid);
        // Fetch user profile from Firestore
        const userDocRef = doc(db, "persons", user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            setCurrentUser({ id: userDocSnap.id, ...userDocSnap.data() } as Person);
        } else {
            // This might happen if Firestore doc creation failed during signup
            // Or if user was created directly in Firebase console
            console.warn("No profile document found for authenticated user:", user.uid);
            setCurrentUser(null);
        }
      } else {
        setCurrentUserId(null);
        setCurrentUser(null);
      }
      setIsReady(true);
    });
    return unsubscribe;
  }, []);
  
  const login = async (email: string, password: string, rememberMe: boolean): Promise<void> => {
    const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistence);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    addLogEntry({
        userId: userCredential.user.uid,
        action: LogAction.LOGIN,
        details: `User logged in.`
    });
  };
  
  const signup = async (name: string, email: string, password: string): Promise<void> => {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const { user } = userCredential;
      
      const newUserProfile: Person = {
          id: user.uid,
          name,
          email: user.email!,
          mobile: '',
          avatarUrl: '',
          aiPrompt: `A busy professional named ${name}.`,
      };
      
      // Use the existing upsertPerson which now talks to Firestore
      await upsertPerson(newUserProfile, user.uid);
      setCurrentUser(newUserProfile);
  };

  const logout = async () => {
    await signOut(auth);
  };
  
  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };
  
  const changePassword = async (newPassword: string) => {
    if (!auth.currentUser) {
        throw new Error("You must be logged in to change your password.");
    }
    await updatePassword(auth.currentUser, newPassword);
  };
  
  const showAccountSettings = () => setAppView('account-settings');
  const showMainApp = () => setAppView('main');

  const value = { 
      currentUser, 
      currentUserId,
      firebaseUser,
      login, 
      signup, 
      logout, 
      isReady,
      appView, 
      showAccountSettings, 
      showMainApp,
      sendPasswordReset,
      changePassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};