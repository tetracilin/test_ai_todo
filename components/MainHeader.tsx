import React from 'react';
import { UserMenu } from './UserMenu';

interface MainHeaderProps {
  title: string;
  onAddItem?: () => void;
  onToggleSidebar: () => void;
}

export const MainHeader: React.FC<MainHeaderProps> = ({ title, onAddItem, onToggleSidebar }) => {
  return (
    <header className="p-2 md:p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center flex-shrink-0">
      <div className="flex items-center space-x-2">
        <button onClick={onToggleSidebar} className="p-1 text-text-secondary dark:text-text-secondary-dark hover:text-primary md:hidden">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
        </button>
        <h1 className="text-xl font-bold text-text-primary dark:text-text-primary-dark hidden md:block">{title}</h1>
      </div>

       <h1 className="text-xl font-bold text-text-primary dark:text-text-primary-dark absolute left-1/2 -translate-x-1/2 md:hidden">{title}</h1>

      <div className="flex items-center space-x-2">
        <div className="w-48 hidden md:block">
          <UserMenu />
        </div>
        {onAddItem && (
            <button onClick={onAddItem} className="p-1 text-primary hover:bg-primary/10 rounded-full transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            </button>
        )}
      </div>
    </header>
  );
};