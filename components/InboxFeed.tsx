
import React, { useState } from 'react';
import { InboxFeedFilter } from '../types';
import { RssIcon } from './icons/RssIcon';
import { FilterVariantIcon } from './icons/FilterVariantIcon';
import { XIcon } from './icons/XIcon';

export interface FeedItem {
    id: string;
    timestamp: string;
    message: React.ReactNode;
    onClick: () => void;
    type: keyof InboxFeedFilter;
}

interface InboxFeedProps {
    feedItems: FeedItem[];
    filter: InboxFeedFilter;
    onFilterChange: (newFilter: InboxFeedFilter) => void;
    onDismiss: (id: string) => void;
    onUndismissAll: () => void;
}

const timeAgo = (date: Date): string => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + "y ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + "mo ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + "d ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m ago";
    return Math.floor(seconds) + "s ago";
};

const FilterPopover: React.FC<{
    currentFilter: InboxFeedFilter;
    onFilterChange: (newFilter: InboxFeedFilter) => void;
    onClose: () => void;
}> = ({ currentFilter, onFilterChange, onClose }) => {

    const handleToggle = (key: keyof InboxFeedFilter) => {
        onFilterChange({ ...currentFilter, [key]: !currentFilter[key] });
    };

    return (
        <div className="absolute top-12 right-0 w-56 bg-surface dark:bg-surface-dark rounded-lg shadow-2xl border border-border-light dark:border-border-dark p-1 z-20">
             <div className="p-2 space-y-1">
                <label className="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer">
                    <input type="checkbox" checked={currentFilter.assignments} onChange={() => handleToggle('assignments')} className="h-4 w-4 rounded text-primary focus:ring-primary border-gray-300 dark:border-gray-600"/>
                    <span>Assignments</span>
                </label>
                <label className="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer">
                    <input type="checkbox" checked={currentFilter.collaborations} onChange={() => handleToggle('collaborations')} className="h-4 w-4 rounded text-primary focus:ring-primary border-gray-300 dark:border-gray-600"/>
                    <span>Collaborations</span>
                </label>
                <label className="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer">
                    <input type="checkbox" checked={currentFilter.subtaskEvents} onChange={() => handleToggle('subtaskEvents')} className="h-4 w-4 rounded text-primary focus:ring-primary border-gray-300 dark:border-gray-600"/>
                    <span>Sub-task Events</span>
                </label>
            </div>
        </div>
    );
};

export const InboxFeed: React.FC<InboxFeedProps> = ({ feedItems, filter, onFilterChange, onDismiss, onUndismissAll }) => {
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    return (
        <div className="flex-1 flex flex-col min-h-0 h-full">
            <header className="flex-shrink-0 flex items-center justify-between p-4 border-b border-border-light dark:border-border-dark">
                <h3 className="font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider text-xs">Inbox Feed</h3>
                <div className="flex items-center space-x-2">
                    <button onClick={onUndismissAll} className="text-xs font-medium text-primary hover:underline">
                        Show All ({feedItems.length})
                    </button>
                    <div className="relative">
                        <button onClick={() => setIsFilterOpen(o => !o)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                            <FilterVariantIcon className="w-5 h-5" />
                        </button>
                        {isFilterOpen && <FilterPopover currentFilter={filter} onFilterChange={onFilterChange} onClose={() => setIsFilterOpen(false)} />}
                    </div>
                </div>
            </header>
            <main className="flex-1 overflow-y-auto p-4">
                {feedItems.length > 0 ? (
                    <ul className="space-y-3">
                        {feedItems.map(item => (
                            <li key={item.id} className="group flex items-start space-x-3">
                                <RssIcon className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark flex-shrink-0 mt-1" />
                                <div className="flex-grow cursor-pointer" onClick={item.onClick}>
                                    <p className="text-sm">{item.message}</p>
                                    <span className="text-xs text-text-secondary dark:text-text-secondary-dark">{timeAgo(new Date(item.timestamp))}</span>
                                </div>
                                <button onClick={() => onDismiss(item.id)} className="p-1 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <XIcon className="w-4 h-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="flex items-center justify-center h-full text-text-secondary dark:text-text-secondary-dark">
                        <p>No new updates based on your filters.</p>
                    </div>
                )}
            </main>
        </div>
    );
};
