import React, { createContext, useContext, ReactNode } from 'react';
import { useTaskStore } from '../hooks/useTaskStore';
import { useAuth } from './AuthContext';

export type TaskContextType = ReturnType<typeof useTaskStore>;

const TaskContext = createContext<TaskContextType | undefined>(undefined);

export const TaskProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUserId, isReady } = useAuth();
  const taskStore = useTaskStore(isReady ? currentUserId : null);
  
  return (
    <TaskContext.Provider value={taskStore}>
      {children}
    </TaskContext.Provider>
  );
};

export const useTasks = (): TaskContextType => {
  const context = useContext(TaskContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TaskProvider');
  }
  return context;
};