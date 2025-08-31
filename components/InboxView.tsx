import React, { useMemo, useCallback } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { MainHeader } from './MainHeader';
import { InboxFeed, FeedItem } from './InboxFeed';
import { InboxTasksSheet } from './InboxTasksSheet';
import { Item, ItemType, Task, Perspective } from '../types';
import { TaskAiInput } from './TaskAiInput';

export const InboxView: React.FC<{
    onSelectItem: (id: string) => void;
    onAddItem: () => void;
    onToggleSidebar: () => void;
    onDeleteItem: (id: string) => void;
    selectedItemId: string | null;
}> = ({ onSelectItem, onAddItem, onToggleSidebar, onDeleteItem, selectedItemId }) => {
    const { 
        getItems, 
        getInbox,
        getPersons,
        getLogs,
        getInboxFeedFilter,
        setInboxFeedFilter,
        getDismissedFeedItemIds,
        dismissFeedItem,
        undismissAllFeedItems,
    } = useTasks();
    const { currentUserId } = useAuth();
    
    const inboxItems = useMemo(() => {
        if (!currentUserId) return [];
        const inboxWp = getInbox();
        if (!inboxWp) return [];
        return getItems().filter((i): i is Task => 
            i.type === ItemType.Task && i.workPackageId === inboxWp.id
        );
    }, [currentUserId, getInbox, getItems]);

    const personMap = useMemo(() => new Map(getPersons().map(p => [p.id, p.name])), [getPersons]);

    const feedItems = useMemo((): FeedItem[] => {
        if (!currentUserId) return [];

        const allItems = getItems();
        const myTasks = new Map<string, Task>();
        const myCollaboratedTasks = new Map<string, Task>();
        
        allItems.forEach(item => {
            if (item.type === ItemType.Task) {
                if (item.assigneeId === currentUserId) {
                    myTasks.set(item.id, item);
                }
                if ((item.collaboratorIds || []).includes(currentUserId)) {
                    myCollaboratedTasks.set(item.id, item);
                }
            }
        });

        const myParentTaskIds = new Set(Array.from(myTasks.keys()));
        
        const rawFeed: (FeedItem & { rawTimestamp: Date })[] = [];
        const addedIds = new Set<string>();

        // 1. New assignments to me
        for (const task of myTasks.values()) {
            const id = `assign-${task.id}-${new Date(task.updatedAt).getTime()}`;
            if (!addedIds.has(id)) {
                rawFeed.push({
                    id,
                    timestamp: task.updatedAt,
                    rawTimestamp: new Date(task.updatedAt),
                    type: 'assignments',
                    message: (
                        <span>
                            You were assigned task: <strong className="font-semibold">{task.title}</strong>
                        </span>
                    ),
                    onClick: () => onSelectItem(task.id),
                });
                addedIds.add(id);
            }
        }
        
        // 2. Added as collaborator
        for (const task of myCollaboratedTasks.values()) {
            const id = `collab-${task.id}-${new Date(task.updatedAt).getTime()}`;
            if (!addedIds.has(id)) {
                 rawFeed.push({
                    id,
                    timestamp: task.updatedAt,
                    rawTimestamp: new Date(task.updatedAt),
                    type: 'collaborations',
                    message: (
                         <span>
                            Added as collaborator on: <strong className="font-semibold">{task.title}</strong>
                        </span>
                    ),
                    onClick: () => onSelectItem(task.id),
                });
                addedIds.add(id);
            }
        }
        
        // 3. Sub-task updates on my assigned tasks
        const subtasksOfMyTasks = allItems.filter((i): i is Task => 
            i.type === ItemType.Task && i.parentId !== null && myParentTaskIds.has(i.parentId)
        );

        for (const subtask of subtasksOfMyTasks) {
            const parentTask = myTasks.get(subtask.parentId!);
            if (!parentTask) continue;
            
            const actorName = personMap.get(subtask.creatorId) || 'Someone';

            const id = `subtask-update-${subtask.id}-${new Date(subtask.updatedAt).getTime()}`;
            if (!addedIds.has(id)) {
                rawFeed.push({
                    id,
                    timestamp: subtask.updatedAt,
                    rawTimestamp: new Date(subtask.updatedAt),
                    type: 'subtaskEvents',
                    message: (
                        <span>
                           <strong className="font-semibold">{actorName}</strong> updated sub-task <strong className="font-semibold">{subtask.title}</strong>
                        </span>
                    ),
                    onClick: () => onSelectItem(subtask.id),
                });
                addedIds.add(id);
            }
        }
        
        const filter = getInboxFeedFilter();
        const dismissedIds = new Set(getDismissedFeedItemIds());
        
        return rawFeed
            .filter(item => !dismissedIds.has(item.id))
            .filter(item => filter[item.type])
            .sort((a, b) => b.rawTimestamp.getTime() - a.rawTimestamp.getTime())
            .slice(0, 50);

    }, [currentUserId, getItems, getLogs, personMap, onSelectItem, getInboxFeedFilter, getDismissedFeedItemIds]);

    return (
        <div className="flex flex-col h-full w-full">
            <MainHeader title="Inbox" onToggleSidebar={onToggleSidebar} />
            <div className="flex-grow flex flex-col overflow-hidden">
                <div className="flex-grow overflow-hidden">
                    <InboxFeed 
                        feedItems={feedItems}
                        filter={getInboxFeedFilter()}
                        onFilterChange={setInboxFeedFilter}
                        onDismiss={dismissFeedItem}
                        onUndismissAll={undismissAllFeedItems}
                    />
                </div>
                <InboxTasksSheet 
                    items={inboxItems} 
                    selectedItemId={selectedItemId} 
                    onSelectItem={onSelectItem}
                    onDeleteItem={onDeleteItem}
                    onAddItem={onAddItem}
                />
            </div>
            <TaskAiInput />
        </div>
    );
};