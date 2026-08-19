import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { useTaskStore } from '../hooks/useTaskStore';
import { useAuth } from './AuthContext';
import taskStoreBridge from './taskStoreBridge';

export type TaskContextType = ReturnType<typeof useTaskStore>;

const TaskContext = createContext<TaskContextType | undefined>(undefined);

export const TaskProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUserId, isReady } = useAuth();
  const taskStore = useTaskStore(isReady ? currentUserId : null);

  useEffect(() => {
    taskStoreBridge.current = taskStore;
    return () => {
      taskStoreBridge.current = null;
    };
  }, [taskStore]);

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