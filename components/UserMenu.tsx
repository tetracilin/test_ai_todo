
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserCircleIcon } from './icons/UserCircleIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { Person } from '../types';

export const UserMenu: React.FC = () => {
  const { users, currentUser, logout, switchUser, showAccountSettings } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (!currentUser) {
    return null;
  }

  const handleSelectUser = (user: Person) => {
    if (currentUser.id !== user.id) {
        switchUser(user.email);
    }
    setIsOpen(false);
  };
  
  const handleAccountSettings = () => {
      showAccountSettings();
      setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors w-full text-left"
      >
        <UserCircleIcon className="w-6 h-6 text-primary" />
        <span className="flex-grow font-semibold text-text-primary dark:text-text-primary-dark truncate">{currentUser.name}</span>
        <ChevronDownIcon className={`w-5 h-5 text-text-secondary dark:text-text-secondary-dark transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute z-10 top-full mt-2 w-full bg-surface dark:bg-surface-dark rounded-lg shadow-lg border border-border-light dark:border-border-dark py-1">
          <div className="px-4 pt-2 pb-1 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark">Switch Account</div>
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => handleSelectUser(user)}
              className="w-full text-left px-4 py-2 text-sm text-text-primary dark:text-text-primary-dark hover:bg-gray-200/50 dark:hover:bg-gray-700/50 flex items-center space-x-3"
            >
              <UserCircleIcon className={`w-5 h-5 ${user.id === currentUser.id ? 'text-primary' : 'text-text-secondary'}`} />
              <span className="truncate">{user.name}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-border-light dark:bg-border-dark" />
           <button
            onClick={handleAccountSettings}
            className="w-full text-left px-4 py-2 text-sm text-text-primary dark:text-text-primary-dark hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
          >
            Account Settings
          </button>
          <button
            onClick={logout}
            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/50"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
};
