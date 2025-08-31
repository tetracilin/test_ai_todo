
import { useCallback } from 'react';
import { Item, ItemType, Task, WorkPackage } from '../types';

export const usePermissions = () => {

    const canViewWorkPackage = useCallback((wp: WorkPackage, userId: string): boolean => {
        if (!wp) return false;
        return wp.creatorId === userId ||
               wp.accountable === userId ||
               wp.responsible.includes(userId) ||
               wp.consulted.includes(userId) ||
               wp.informed.includes(userId);
    }, []);

    const canEditWorkPackage = useCallback((wp: WorkPackage, userId: string): boolean => {
        if (!wp) return false;
        // creatorId is checked in canEditItem.
        return wp.accountable === userId ||
               wp.responsible.includes(userId) ||
               wp.consulted.includes(userId);
    }, []);

    const canViewItem = useCallback((item: Item, userId: string, allItems: Item[]): boolean => {
        if (!item || !userId) return false;
        if (item.creatorId === userId) return true;

        if (item.type === ItemType.WorkPackage) {
            return canViewWorkPackage(item as WorkPackage, userId);
        }

        if (item.type === ItemType.Task) {
            const task = item as Task;
            
            // Assignee or collaborator can view the task
            if (task.assigneeId === userId) return true;
            if ((task.collaboratorIds || []).includes(userId)) return true;

            // For Inbox tasks, only the creator can see them (if not assigned/collaborating).
            if (!task.workPackageId) return item.creatorId === userId;
            
            const wp = allItems.find(i => i.id === task.workPackageId) as WorkPackage | undefined;
            return wp ? canViewWorkPackage(wp, userId) : false;
        }

        return false;
    }, [canViewWorkPackage]);

    const canEditItem = useCallback((item: Item, userId:string, allItems: Item[]): boolean => {
        if (!item || !userId) return false;
        if (item.creatorId === userId) return true;

        if (item.type === ItemType.WorkPackage) {
             return canEditWorkPackage(item as WorkPackage, userId);
        }

        if (item.type === ItemType.Task) {
            const task = item as Task;
            // The person assigned to the task can edit it.
            if (task.assigneeId === userId) return true;
            // A collaborator can also edit.
            if ((task.collaboratorIds || []).includes(userId)) return true;
            
            // For Inbox tasks, only creator can edit.
            if (!task.workPackageId) return item.creatorId === userId;

            const wp = allItems.find(i => i.id === task.workPackageId) as WorkPackage | undefined;
            return wp ? canEditWorkPackage(wp, userId) : false;
        }

        return false;
    }, [canEditWorkPackage]);

    const getVisibleItemsForUser = useCallback((userId: string, allItems: Item[]): Item[] => {
        if (!userId) return [];
        return allItems.filter(item => canViewItem(item, userId, allItems));
    }, [canViewItem]);

    return {
        canViewItem,
        canEditItem,
        getVisibleItemsForUser
    };
};