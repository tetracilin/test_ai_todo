
import React, { createContext, useContext, ReactNode } from 'react';
import { useTaskStore, UseTaskStoreReturn } from '../hooks/useTaskStore';

const TaskContext = createContext<UseTaskStoreReturn | undefined>(undefined);

export const TaskProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const taskStore = useTaskStore();
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
