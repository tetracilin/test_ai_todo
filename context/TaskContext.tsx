import React, { createContext, useContext, ReactNode } from 'react';
import { useTaskStore, UseTaskStoreReturn } from '../hooks/useTaskStore';
import { useAuth } from './AuthContext';

const TaskContext = createContext<UseTaskStoreReturn | undefined>(undefined);

export const TaskProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUserId, isReady } = useAuth();
  const taskStore = useTaskStore(isReady ? currentUserId : null);
  
  return (
    <TaskContext.Provider value={taskStore}>
      {children}
    </TaskContext.Provider>
  );
};

export const useTasks = (): UseTaskStoreReturn => {
  const context = useContext(TaskContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TaskProvider');
  }
  return context;
};