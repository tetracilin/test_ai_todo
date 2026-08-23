import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Person } from '../types';
import {
    getSessionUser,
    clearSession,
    signInLocally,
    signUpLocally,
    sendPasswordResetLocally,
    changePasswordLocally,
    SessionUser,
} from '../services/localAuth';

interface AuthContextType {
  currentUser: Person | null;
  currentUserId: string | null;
  sessionUser: SessionUser | null;
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
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [appView, setAppView] = useState<'main' | 'account-settings'>('main');

  // Restore a persisted session on boot. Profiles are loaded by TaskProvider
  // once the task store hydrates; here we only re-establish the identity.
  useEffect(() => {
    const session = getSessionUser();
    if (session) {
      setSessionUser(session);
      setCurrentUserId(session.uid);
    }
    setIsReady(true);
  }, []);

  const login = async (email: string, password: string, _rememberMe: boolean): Promise<void> => {
    // rememberMe is kept for UI compatibility; sessions are always local and
    // persist across browser restarts.
    const session = await signInLocally(email, password);
    setSessionUser(session);
    setCurrentUserId(session.uid);
    setCurrentUser(null);
  };

  const signup = async (name: string, email: string, password: string): Promise<void> => {
    const session = await signUpLocally(name, email, password);
    setSessionUser(session);
    setCurrentUserId(session.uid);
    setCurrentUser({
      id: session.uid,
      name,
      email: session.email,
      mobile: '',
      avatarUrl: '',
      aiPrompt: `A busy professional named ${name}.`,
    });
  };

  const logout = () => {
    clearSession();
    setSessionUser(null);
    setCurrentUserId(null);
    setCurrentUser(null);
    setAppView('main');
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetLocally(email);
  };

  const changePassword = async (newPassword: string) => {
    if (!currentUserId) {
      throw new Error("You must be logged in to change your password.");
    }
    await changePasswordLocally(currentUserId, newPassword);
  };

  const showAccountSettings = () => setAppView('account-settings');
  const showMainApp = () => setAppView('main');

  const value: AuthContextType = {
      currentUser,
      currentUserId,
      sessionUser,
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
