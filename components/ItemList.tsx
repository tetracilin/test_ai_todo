
import React, { useMemo, useState, useCallback } from 'react';
import { Item, ItemStatus, ItemType, Task, Perspective, Tag } from '../types';
import { WorkPackageIcon } from './icons/ProjectIcon';
import { FlagIcon } from './icons/FlagIcon';
import { TrashIcon } from './icons/TrashIcon';
import { TaskIcon } from './icons/TaskIcon';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

type ItemWithChildren = Item & {
  children: ItemWithChildren[];
};

const ItemRow: React.FC<{
  item: Item;
  isSelected: boolean;
  onSelect: () => void;
  onToggleComplete: (item: Item, e: React.MouseEvent) => void;
  onDeleteItem: (item: Item, e: React.MouseEvent) => void;
  canEdit: boolean;
  isDraggable: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, item: Item) => void;
  onDrop: (e: React.DragEvent, item: Item) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent, item: Item) => void;
  onDragLeave: (e: React.DragEvent) => void;
}> = ({ 
    item, isSelected, onSelect, onToggleComplete, onDeleteItem, canEdit,
    isDraggable, isDragOver, onDragStart, onDrop, onDragOver, onDragEnter, onDragLeave
}) => {
  const isCompleted = item.status === ItemStatus.Completed;

  return (
    <div
      onClick={onSelect}
      draggable={isDraggable}
      onDragStart={(e) => onDragStart(e, item)}
      onDrop={(e) => onDrop(e, item)}
      onDragOver={onDragOver}
      onDragEnter={(e) => onDragEnter(e, item)}
      onDragLeave={onDragLeave}
      className={`group flex items-center p-3 rounded-lg cursor-pointer transition-all duration-150 ${
        isSelected ? 'bg-primary/20' : 'hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
      } ${isDragOver ? 'outline outline-2 outline-primary outline-offset-[-2px]' : ''} ${isDraggable ? 'touch-pan-y' : ''}`}
    >
      <button 
        onClick={(e) => onToggleComplete(item, e)} 
        disabled={!canEdit}
        className="mr-3 flex-shrink-0 disabled:cursor-not-allowed">
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
          isCompleted ? 'bg-primary border-primary' : `border-gray-400 dark:border-gray-500 ${canEdit ? 'hover:border-primary' : ''}`
        }`}>
          {isCompleted && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
        </div>
      </button>
      <div className="flex-grow truncate">
        <p className={`truncate text-sm ${isCompleted ? 'line-through text-text-secondary dark:text-text-secondary-dark' : 'text-text-primary dark:text-text-primary-dark'}`}>
          {item.title}
        </p>
        {item.type === ItemType.Task && item.note && (
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark truncate">{item.note}</p>
        )}
      </div>
      <div className="flex items-center flex-shrink-0 ml-3 space-x-2">
        {item.flagged && <FlagIcon className="w-4 h-4 text-orange-500" />}
        {item.type === ItemType.WorkPackage && <WorkPackageIcon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />}
        {item.type === ItemType.Task && <TaskIcon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark" />}
        {canEdit && (
            <button 
                onClick={(e) => onDeleteItem(item, e)} 
                className="p-1 rounded-full text-text-secondary dark:text-text-secondary-dark hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Delete ${item.title}`}
            >
                <TrashIcon className="w-4 h-4" />
            </button>
        )}
      </div>
    </div>
  );
};

const RecursiveItemRow: React.FC<{
    item: ItemWithChildren;
    level: number;
    selectedItemId: string | null;
    onSelectItem: (id: string) => void;
    onToggleComplete: (item: Item, e: React.MouseEvent) => void;
    onDeleteItem: (item: Item, e: React.MouseEvent) => void;
    canEditItem: (item: Item) => boolean;
    isDraggable: (item: Item) => boolean;
    dragOverItemId: string | null;
    onDragStart: (e: React.DragEvent, item: Item) => void;
    onDrop: (e: React.DragEvent, item: Item) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent, item: Item) => void;
    onDragLeave: (e: React.DragEvent) => void;
}> = ({ 
    item, level, selectedItemId, onSelectItem, onToggleComplete, onDeleteItem, canEditItem,
    isDraggable, dragOverItemId, ...dragHandlers
}) => {
    return (
        <div>
            <div style={{ paddingLeft: `${level * 1.5}rem` }}>
                <ItemRow 
                    item={item} 
                    isSelected={item.id === selectedItemId}
                    onSelect={() => onSelectItem(item.id)}
                    onToggleComplete={onToggleComplete}
                    onDeleteItem={onDeleteItem}
                    canEdit={canEditItem(item)}
                    isDraggable={isDraggable(item)}
                    isDragOver={dragOverItemId === item.id}
                    {...dragHandlers}
                />
            </div>
            {item.children.length > 0 && (
                <div>
                    {item.children.map(child => (
                        <RecursiveItemRow 
                            key={child.id}
                            item={child}
                            level={level + 1}
                            selectedItemId={selectedItemId}
                            onSelectItem={onSelectItem}
                            onToggleComplete={onToggleComplete}
                            onDeleteItem={onDeleteItem}
                            canEditItem={canEditItem}
                            isDraggable={isDraggable}
                            dragOverItemId={dragOverItemId}
                            {...dragHandlers}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export const ItemList: React.FC<{
  items: Item[];
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  activeView: string;
}> = ({ items, selectedItemId, onSelectItem, onDeleteItem, activeView }) => {
  const { upsertItem, getTags, getDescendants, getItems } = useTasks();
  const { currentUserId } = useAuth();
  const { canEditItem } = usePermissions();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);

  const allItemsFromStore = getItems();

  const userCanEdit = useCallback((item: Item): boolean => {
      if (!currentUserId) return false;
      return canEditItem(item, currentUserId, allItemsFromStore);
  }, [canEditItem, currentUserId, allItemsFromStore]);

  const handleToggleComplete = (item: Item, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId || !userCanEdit(item)) {
        alert("You don't have permission to modify this item.");
        return;
    }
    const isCompleted = item.status === ItemStatus.Completed;
    upsertItem({
        id: item.id,
        status: isCompleted ? ItemStatus.Active : ItemStatus.Completed,
        completedAt: isCompleted ? null : new Date().toISOString()
    }, currentUserId);
  };

  const handleDeleteItem = (item: Item, e: React.MouseEvent) => {
      e.stopPropagation();
      if (window.confirm(`Are you sure you want to delete "${item.title}"? This cannot be undone.`)) {
        onDeleteItem(item.id);
      }
  };
    
  const rootItems: ItemWithChildren[] = useMemo(() => {
    const itemMap: Map<string, ItemWithChildren> = new Map(
        items.map(item => [item.id, { ...item, children: [] }])
    );
    const roots: ItemWithChildren[] = [];

    for (const item of itemMap.values()) {
        if (item.parentId && itemMap.has(item.parentId)) {
            const parent = itemMap.get(item.parentId);
            if (parent) {
                parent.children.push(item);
            }
        } else {
            roots.push(item);
        }
    }
    return roots;
  }, [items]);

  const tagGroups = useMemo(() => {
    if (activeView !== Perspective.Tags) return null;
    
    const groups = new Map<string, { name: string; tasks: Task[] }>();
    const noTagTasks: Task[] = [];
    const allTags = getTags();

    allTags.forEach(tag => groups.set(tag.id, { name: tag.name, tasks: [] }));

    (items as Task[]).forEach(task => {
        if (task.tagIds.length === 0) {
            noTagTasks.push(task);
        } else {
            task.tagIds.forEach(tagId => {
                if (groups.has(tagId)) {
                    groups.get(tagId)!.tasks.push(task);
                }
            });
        }
    });

    const sortedGroups = [...groups.values()].filter(g => g.tasks.length > 0).sort((a,b) => a.name.localeCompare(b.name));
    if (noTagTasks.length > 0) {
        sortedGroups.push({ name: 'No Tag', tasks: noTagTasks });
    }
    
    return sortedGroups;
  }, [activeView, items, getTags]);

  const isDraggable = (item: Item) =>
    (userCanEdit(item)) &&
    ((activeView.startsWith('workPackage/') && item.type === ItemType.Task) ||
    (activeView === Perspective.WorkPackages && item.type === ItemType.WorkPackage));

  const handleDragStart = (e: React.DragEvent, item: Item) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/json', JSON.stringify({ id: item.id }));
      setDraggedItemId(item.id);
  };
  
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  
  const handleDragEnter = (e: React.DragEvent, item: Item) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItemId && draggedItemId !== item.id) {
        setDragOverItemId(item.id);
    }
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverItemId(null);
  };

  const handleDrop = (e: React.DragEvent, dropTarget: Item) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverItemId(null);
    if (!draggedItemId || draggedItemId === dropTarget.id || !currentUserId) return;

    const draggedItem = items.find(i => i.id === draggedItemId);
    if (!draggedItem) return;
    
    if (!userCanEdit(draggedItem)) return;

    const descendants = getDescendants(draggedItemId);
    if (descendants.has(dropTarget.id)) return; // Prevent dropping on a child

    const isTaskDrop = draggedItem.type === ItemType.Task && dropTarget.type === ItemType.Task && activeView.startsWith('workPackage/');
    const isWorkPackageDrop = draggedItem.type === ItemType.WorkPackage && dropTarget.type === ItemType.WorkPackage && activeView === Perspective.WorkPackages;

    if (isTaskDrop || isWorkPackageDrop) {
        upsertItem({ id: draggedItemId, parentId: dropTarget.id }, currentUserId);
    }
    
    setDraggedItemId(null);
  };

  const handleRootDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverItemId(null);
      if (!draggedItemId || !currentUserId) return;
      
      const draggedItem = items.find(i => i.id === draggedItemId);
      if (!draggedItem) return;
      if (!userCanEdit(draggedItem)) return;
      
      const isTaskRootDrop = draggedItem.type === ItemType.Task && activeView.startsWith('workPackage/');
      const isWorkPackageRootDrop = draggedItem.type === ItemType.WorkPackage && activeView === Perspective.WorkPackages;
      
      if (isTaskRootDrop || isWorkPackageRootDrop) {
        upsertItem({ id: draggedItemId, parentId: null }, currentUserId);
      }

      setDraggedItemId(null);
  };
  
  const dragHandlers = { onDragStart: handleDragStart, onDrop: handleDrop, onDragOver: handleDragOver, onDragEnter: handleDragEnter, onDragLeave: handleDragLeave };

  return (
    <div className="flex-1 overflow-y-auto p-2" onDrop={handleRootDrop} onDragOver={handleDragOver}>
      {items.length > 0 ? (
          activeView === Perspective.Tags && tagGroups ? (
               <div className="space-y-4">
                  {tagGroups.map(group => (
                      <div key={group.name}>
                          <h2 className="px-3 pt-2 pb-1 text-sm font-semibold text-text-secondary dark:text-text-secondary-dark sticky top-0 bg-surface/80 dark:bg-surface-dark/80 backdrop-blur-sm">{group.name}</h2>
                          <div className="space-y-1">
                              {group.tasks.map(item => (
                                  <ItemRow
                                      key={item.id}
                                      item={item}
                                      isSelected={item.id === selectedItemId}
                                      onSelect={() => onSelectItem(item.id)}
                                      onToggleComplete={handleToggleComplete}
                                      onDeleteItem={handleDeleteItem}
                                      canEdit={userCanEdit(item)}
                                      isDraggable={false}
                                      isDragOver={false}
                                      {...{ onDragStart: ()=>{}, onDrop: ()=>{}, onDragOver: ()=>{}, onDragEnter: ()=>{}, onDragLeave: ()=>{} }}
                                  />
                              ))}
                          </div>
                      </div>
                  ))}
               </div>
          ) : (
            <div className="space-y-1">
              {rootItems.map(item => (
                <RecursiveItemRow
                  key={item.id}
                  item={item}
                  level={0}
                  selectedItemId={selectedItemId}
                  onSelectItem={onSelectItem}
                  onToggleComplete={handleToggleComplete}
                  onDeleteItem={handleDeleteItem}
                  canEditItem={userCanEdit}
                  isDraggable={isDraggable}
                  dragOverItemId={dragOverItemId}
                  {...dragHandlers}
                />
              ))}
            </div>
          )
      ) : (
        <div className="text-center py-10">
          <p className="text-text-secondary dark:text-text-secondary-dark">No items in this view.</p>
        </div>
      )}
    </div>
  );
};
