import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { Person, LogAction, SecurityQuestion } from '../types';
import { useTasks } from './TaskContext';
import { hashPassword } from '../services/cryptoService';

interface AuthContextType {
  users: Person[];
  currentUser: Person | null;
  currentUserId: string | null;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  isReady: boolean;
  switchUser: (email: string) => void;
  setCurrentUserId: (id: string | null, rememberMe?: boolean) => void;
  loginTargetEmail: string | null;
  appView: 'main' | 'account-settings';
  showAccountSettings: () => void;
  showMainApp: () => void;
  findUserByEmail: (email: string) => Promise<Person | null>;
  verifySecurityAnswers: (userId: string, answers: string[]) => Promise<boolean>;
  resetPassword: (userId: string, newPassword: string) => Promise<void>;
  changePassword: (userId: string, oldPassword: string, newPassword: string) => Promise<void>;
  setSecurityQuestions: (userId: string, password: string, questions: { question: string, answer: string }[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_USER_ID_KEY = 'gemini-task-manager-userId';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { getPersons, addLogEntry, upsertPerson } = useTasks();
  const users = getPersons();
  // Fix: Rename state setter to avoid conflict with exported function
  const [currentUserId, _setCurrentUserId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [loginTargetEmail, setLoginTargetEmail] = useState<string | null>(null);
  const [appView, setAppView] = useState<'main' | 'account-settings'>('main');

  useEffect(() => {
    try {
        const storedUserId = localStorage.getItem(AUTH_USER_ID_KEY);
        if (storedUserId && users.some(u => u.id === storedUserId)) {
            // Fix: Use renamed state setter
            _setCurrentUserId(storedUserId);
        }
    } catch (e) {
        console.error("Failed to read user from localStorage", e);
    }
    setIsReady(true);
  }, []);

  const clearLoginTargetEmail = () => {
    setLoginTargetEmail(null);
  };

  // Fix: Renamed from handleSetCurrentUserId and will be exported
  const setCurrentUserId = (id: string | null, rememberMe: boolean = false) => {
      if (id && id !== currentUserId) {
         const user = users.find(u => u.id === id);
         if(user) {
            addLogEntry({
                userId: id,
                action: LogAction.LOGIN,
                details: `User "${user.name}" logged in.`
            });
         }
      }
      
      try {
        if (id && rememberMe) {
            localStorage.setItem(AUTH_USER_ID_KEY, id);
        } else {
            localStorage.removeItem(AUTH_USER_ID_KEY);
        }
      } catch (e) {
        console.error("Failed to save user to localStorage", e);
      }

      // Fix: Use renamed state setter
      _setCurrentUserId(id);
      setAppView('main');
  };
  
  const login = async (email: string, password: string, rememberMe: boolean): Promise<void> => {
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !user.passwordHash) {
      throw new Error("Invalid email or password.");
    }

    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) {
      throw new Error("Invalid email or password.");
    }

    // Fix: Use renamed function
    setCurrentUserId(user.id, rememberMe);
    if (loginTargetEmail) {
        clearLoginTargetEmail();
    }
  };
  
  const signup = async (name: string, email: string, password: string): Promise<void> => {
      const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (existingUser) {
          throw new Error("An account with this email already exists.");
      }

      const passwordHash = await hashPassword(password);
      
      const newUser: Person = {
          id: crypto.randomUUID(),
          name,
          email,
          passwordHash,
          mobile: '',
          avatarUrl: '',
          aiPrompt: `A busy professional named ${name}.`,
          securityQuestions: [],
      };
      
      upsertPerson(newUser, newUser.id);
      // Fix: Use renamed function
      setCurrentUserId(newUser.id, true);
      if (loginTargetEmail) {
          clearLoginTargetEmail();
      }
  };

  const findUserByEmail = async (email: string): Promise<Person | null> => {
      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      return user || null;
  }

  const verifySecurityAnswers = async (userId: string, answers: string[]): Promise<boolean> => {
      const user = users.find(u => u.id === userId);
      if (!user || !user.securityQuestions || user.securityQuestions.length !== 2 || answers.length !== 2) {
          return false;
      }
      const hashedAnswers = await Promise.all(answers.map(a => hashPassword(a)));
      return hashedAnswers[0] === user.securityQuestions[0].answerHash && hashedAnswers[1] === user.securityQuestions[1].answerHash;
  };

  const resetPassword = async (userId: string, newPassword: string): Promise<void> => {
      const user = users.find(u => u.id === userId);
      if (!user) throw new Error("User not found.");
      
      const newPasswordHash = await hashPassword(newPassword);
      const updatedUser = { ...user, passwordHash: newPasswordHash };
      upsertPerson(updatedUser, userId); // Logged as user themselves
  };

  const changePassword = async (userId: string, oldPassword: string, newPassword: string): Promise<void> => {
      const user = users.find(u => u.id === userId);
      if (!user || !user.passwordHash) throw new Error("User not found or password not set.");
      
      const oldPasswordHash = await hashPassword(oldPassword);
      if (oldPasswordHash !== user.passwordHash) {
          throw new Error("The current password you entered is incorrect.");
      }
      
      const newPasswordHash = await hashPassword(newPassword);
      const updatedUser = { ...user, passwordHash: newPasswordHash };
      upsertPerson(updatedUser, userId);
  };
  
  const setSecurityQuestions = async (userId: string, password: string, questions: { question: string, answer: string }[]): Promise<void> => {
      const user = users.find(u => u.id === userId);
      if (!user || !user.passwordHash) throw new Error("User not found or password not set.");
      
      const passwordHash = await hashPassword(password);
      if (passwordHash !== user.passwordHash) {
          throw new Error("The password you entered is incorrect.");
      }
      
      const hashedQuestions: SecurityQuestion[] = await Promise.all(
          questions.map(async q => ({
              question: q.question,
              answerHash: await hashPassword(q.answer)
          }))
      );
      
      const updatedUser = { ...user, securityQuestions: hashedQuestions };
      upsertPerson(updatedUser, userId);
  };

  useEffect(() => {
    if (currentUserId && !users.some(u => u.id === currentUserId)) {
        // Fix: Use renamed function
        setCurrentUserId(null);
    }
  }, [users, currentUserId]);
  
  const logout = () => {
    // Fix: Use renamed function
    setCurrentUserId(null);
  };

  const switchUser = (email: string) => {
    logout();
    setLoginTargetEmail(email);
  };
  
  const showAccountSettings = () => setAppView('account-settings');
  const showMainApp = () => setAppView('main');

  const currentUser = useMemo(() => {
    return users.find(u => u.id === currentUserId) || null;
  }, [currentUserId, users]);

  const value = { 
      users, currentUser, currentUserId, login, signup, logout, isReady, switchUser, loginTargetEmail,
      appView, showAccountSettings, showMainApp, findUserByEmail, verifySecurityAnswers, resetPassword,
      changePassword, setSecurityQuestions,
      // Fix: Export the new setCurrentUserId function
      setCurrentUserId
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