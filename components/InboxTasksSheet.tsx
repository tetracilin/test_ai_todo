
import React, { useState } from 'react';
import { Item, Perspective } from '../types';
import { ItemList } from './ItemList';
import { InboxIcon } from './icons/InboxIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { PlusIcon } from './icons/PlusIcon';

interface InboxTasksSheetProps {
    items: Item[];
    selectedItemId: string | null;
    onSelectItem: (id: string) => void;
    onDeleteItem: (id: string) => void;
    onAddItem: () => void;
}

export const InboxTasksSheet: React.FC<InboxTasksSheetProps> = ({ items, selectedItemId, onSelectItem, onDeleteItem, onAddItem }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const toggleExpansion = () => setIsExpanded(!isExpanded);

    return (
        <div className={`relative flex-shrink-0 bg-gray-50 dark:bg-gray-900/50 border-t-2 border-border-light dark:border-border-dark shadow-[0_-4px_12px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out ${isExpanded ? 'h-3/4' : 'h-24'}`}>
            <div className="w-full h-full flex flex-col">
                {/* Header */}
                <div 
                    className="flex items-center justify-between p-3 cursor-pointer"
                    onClick={toggleExpansion}
                    role="button"
                    aria-expanded={isExpanded}
                    aria-controls="inbox-tasks-content"
                >
                    <div className="flex items-center space-x-2">
                        <InboxIcon className="w-5 h-5 text-primary" />
                        <h2 className="font-bold text-lg text-text-primary dark:text-text-primary-dark">Captured ({items.length})</h2>
                    </div>
                     <div className="flex items-center space-x-2">
                         <button 
                            onClick={(e) => { e.stopPropagation(); onAddItem(); }} 
                            className="flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/20"
                            aria-label="Add new task to inbox"
                         >
                            <PlusIcon className="w-4 h-4 mr-1"/>
                            Add Task
                        </button>
                        <ChevronDownIcon className={`w-6 h-6 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                </div>

                {/* Content */}
                <div id="inbox-tasks-content" className="flex-1 overflow-hidden">
                    {isExpanded ? (
                         <ItemList 
                            items={items} 
                            selectedItemId={selectedItemId} 
                            onSelectItem={onSelectItem}
                            onDeleteItem={onDeleteItem}
                            activeView={Perspective.Inbox}
                        />
                    ) : (
                        <div className="px-4 text-sm text-text-secondary dark:text-text-secondary-dark truncate">
                           {items.length > 0
                                ? items.slice(0, 3).map(item => item.title).join(', ') + (items.length > 3 ? '...' : '')
                                : 'No tasks in inbox.'
                            }
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
