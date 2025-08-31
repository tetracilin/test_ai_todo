
import React, { useState, useEffect, useMemo } from 'react';
import { Item, ItemStatus, ItemType, Task, WorkPackage, Tag, Person } from './types';
import { useTasks } from './context/TaskContext';
import { useAuth } from './context/AuthContext';
import { usePermissions } from './hooks/usePermissions';
import { generateSubTasks } from './services/geminiService';
import { FlagIcon } from './components/icons/FlagIcon';
import { TrashIcon } from './components/icons/TrashIcon';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { XIcon } from './components/icons/XIcon';
import { ChevronLeftIcon } from './components/icons/ChevronLeftIcon';
import { UserIcon } from './components/icons/UserIcon';
import { ClarificationModal } from './components/ClarificationModal';
import { ClipboardCheckIcon } from './components/icons/ClipboardCheckIcon';

export const ItemDetail: React.FC<{
  itemId: string | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}> = ({ itemId, onClose, onDelete }) => {
  const { getItem, getItems, getTags, getPersons, upsertItem, upsertTag, addSubTasksToWorkPackage, getDescendants, getAiConfig } = useTasks();
  const { currentUserId } = useAuth();
  const { canEditItem } = usePermissions();
  const [item, setItem] = useState<Item | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [isClarificationModalOpen, setIsClarificationModalOpen] = useState(false);

  const allItems = getItems();
  const allWorkPackages = useMemo(() => allItems.filter(i => i.type === ItemType.WorkPackage) as WorkPackage[], [allItems]);
  const allTags = getTags();
  const allPersons = getPersons();
  const aiConfig = getAiConfig();

  const parentCandidateTasks = useMemo(() => {
    if (!item || item.type !== ItemType.Task) return [];
    const descendants = getDescendants(item.id);
    return allItems.filter((i): i is Task => 
        i.type === ItemType.Task && 
        i.id !== item.id && 
        !descendants.has(i.id)
    );
  }, [item, allItems, getDescendants]);

  const parentCandidateWorkPackages = useMemo(() => {
    if (!item || item.type !== ItemType.WorkPackage) return [];
    const descendants = getDescendants(item.id);
    return allItems.filter((p): p is WorkPackage =>
        p.type === ItemType.WorkPackage &&
        p.id !== item.id &&
        !descendants.has(p.id) &&
        p.title !== 'Inbox'
    );
  }, [item, allItems, getDescendants]);


  useEffect(() => {
    if (itemId) {
      const foundItem = getItem(itemId) || null;
      setItem(foundItem);
       if (foundItem && currentUserId) {
          setCanEdit(canEditItem(foundItem, currentUserId, allItems));
      } else {
          setCanEdit(false);
      }
    } else {
      setItem(null);
      setCanEdit(false);
    }
    setAiError(null);
    setTagInput('');
  }, [itemId, getItem, currentUserId, canEditItem, allItems]);

  const handleUpdate = (updates: Partial<Item>) => {
    if (item && canEdit && currentUserId) {
      const updatedItem = { ...item, ...updates } as Item;
      setItem(updatedItem);
      upsertItem(updatedItem, currentUserId);
    }
  };
  
  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && tagInput.trim() && item?.type === ItemType.Task && currentUserId) {
          e.preventDefault();
          const tagName = tagInput.trim();
          let tag = allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
          if (!tag) {
              tag = { id: crypto.randomUUID(), name: tagName };
              upsertTag(tag, currentUserId);
          }
          if (!(item as Task).tagIds.includes(tag.id)) {
              handleUpdate({ tagIds: [...(item as Task).tagIds, tag.id] });
          }
          setTagInput('');
      }
  };

  const handleRemoveTag = (tagId: string) => {
      if (item?.type === ItemType.Task) {
          handleUpdate({ tagIds: (item as Task).tagIds.filter(id => id !== tagId) });
      }
  };

  const handleGenerateSubtasks = async () => {
    if (!item || item.type !== ItemType.WorkPackage || !currentUserId || !canEdit) return;
    setIsGenerating(true);
    setAiError(null);
    try {
      const subTasks = await generateSubTasks(aiConfig.workPackageSubtaskGenerationMasterPrompt, item.title);
      addSubTasksToWorkPackage(item.id, subTasks, currentUserId);
    } catch (error) {
        if (error instanceof Error) {
            setAiError(error.message);
        } else {
            setAiError("An unknown error occurred.");
        }
    } finally {
      setIsGenerating(false);
    }
  };

  if (!item) {
    return (
      <div className="w-full md:w-1/3 h-full bg-surface dark:bg-surface-dark flex items-center justify-center border-l border-border-light dark:border-border-dark">
        <p className="text-text-secondary dark:text-text-secondary-dark">Select an item to see details</p>
      </div>
    );
  }

  const taskItem = item.type === ItemType.Task ? item : null;
  const workPackageItem = item.type === ItemType.WorkPackage ? item : null;
  const isAccountable = workPackageItem?.accountable === currentUserId;


    const MultiPersonRoleSection: React.FC<{
    role: 'responsible' | 'consulted' | 'informed';
    title: string;
    description: string;
  }> = ({ role, title, description }) => {
      if (!workPackageItem) return null;

      const assignedIds = workPackageItem[role] || [];
      const assignedPersons = assignedIds.map(id => allPersons.find(p => p.id === id)).filter((p): p is Person => p !== undefined);
      const availablePersons = allPersons.filter(p => !assignedIds.includes(p.id));

      const handleAdd = (personId: string) => {
          if (personId) {
              handleUpdate({ [role]: [...assignedIds, personId] });
          }
      };

      const handleRemove = (personId: string) => {
          handleUpdate({ [role]: assignedIds.filter(id => id !== personId) });
      };

      return (
          <div>
              <h4 className="font-semibold text-text-primary dark:text-text-primary-dark">{title}</h4>
              <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-2">{description}</p>
              <div className="flex flex-wrap gap-2 items-center mb-2 min-h-[34px]">
                  {assignedPersons.map(person => (
                      <span key={person.id} className="flex items-center bg-gray-200 text-gray-800 text-sm font-medium px-2.5 py-1 rounded-full dark:bg-gray-700 dark:text-gray-300">
                           <UserIcon className="w-4 h-4 mr-1.5" />
                          {person.name}
                          <button onClick={() => handleRemove(person.id)} disabled={!canEdit} className="ml-1.5 -mr-1 p-0.5 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                              <XIcon className="w-3 h-3" />
                          </button>
                      </span>
                  ))}
              </div>
              {availablePersons.length > 0 && (
                   <select
                      onChange={(e) => {
                        handleAdd(e.target.value);
                        e.target.value = "";
                      }}
                      value=""
                      disabled={!canEdit}
                      className="w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                      <option value="" disabled>+ Add Person...</option>
                      {availablePersons.map(person => (
                          <option key={person.id} value={person.id}>{person.name}</option>
                      ))}
                  </select>
              )}
          </div>
      );
  };

  return (
    <>
    <div className="w-full h-full bg-surface dark:bg-surface-dark flex flex-col animate-slide-in overflow-y-auto border-l border-border-light dark:border-border-dark">
      <div className="flex-grow p-4 md:p-6 space-y-6">
        <div className="flex items-start justify-between">
            <button onClick={onClose} className="p-2 -ml-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors md:hidden">
                <ChevronLeftIcon className="w-6 h-6" />
            </button>
          <input
            type="text"
            value={item.title}
            onChange={(e) => handleUpdate({ title: e.target.value })}
            disabled={!canEdit}
            className="text-2xl font-bold bg-transparent border-none w-full focus:ring-0 p-0 mx-2 text-text-primary dark:text-text-primary-dark disabled:opacity-70"
          />
           <div className="flex items-center flex-shrink-0 space-x-1">
              <button onClick={() => handleUpdate({ flagged: !item.flagged })} disabled={!canEdit} className={`p-2 rounded-full transition-colors ${item.flagged ? 'text-orange-500 bg-orange-100 dark:bg-orange-900/50' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'} disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:text-gray-400`}>
                  <FlagIcon />
              </button>
              <button onClick={onClose} className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors hidden md:block">
                <XIcon className="w-5 h-5" />
              </button>
           </div>
        </div>

        <div>
          <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Notes</label>
          <textarea
            value={item.note}
            onChange={(e) => handleUpdate({ note: e.target.value })}
            placeholder={canEdit ? "Add a note..." : "No note"}
            rows={5}
            disabled={!canEdit}
            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70"
          />
        </div>
        
        {taskItem && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                  <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Due Date</label>
                  <input
                      type="date"
                      value={taskItem.dueDate ? taskItem.dueDate.split('T')[0] : ''}
                      onChange={(e) => handleUpdate({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                      disabled={!canEdit}
                      className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed"
                  />
              </div>
              <div>
                  <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Scheduled Time</label>
                  <input
                      type="time"
                      value={taskItem.scheduledTime || ''}
                      onChange={(e) => handleUpdate({ scheduledTime: e.target.value || null })}
                      disabled={!canEdit}
                      className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed"
                  />
              </div>
            </div>
             <div>
                  <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Estimate (minutes)</label>
                  <input
                      type="number"
                      min="0"
                      value={taskItem.estimate || ''}
                      onChange={(e) => handleUpdate({ estimate: e.target.value ? parseInt(e.target.value, 10) : null })}
                      disabled={!canEdit}
                      className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed"
                  />
              </div>
            <div>
                <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Work Package</label>
                <select value={taskItem.workPackageId || ''} onChange={e => handleUpdate({ workPackageId: e.target.value || null })} disabled={!canEdit} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed">
                    {allWorkPackages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
            </div>
            <div>
                <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Parent Task</label>
                <select value={taskItem.parentId || ''} onChange={e => handleUpdate({ parentId: e.target.value || null })} disabled={!canEdit} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed">
                    <option value="">None</option>
                    {parentCandidateTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
            </div>
            <div>
                <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Tags</label>
                <div className="mt-1 flex flex-wrap gap-2 items-center">
                    {(taskItem.tagIds || []).map(tagId => {
                        const tag = allTags.find(t => t.id === tagId);
                        return tag ? (
                            <span key={tag.id} className="flex items-center bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">
                                {tag.name}
                                <button onClick={() => handleRemoveTag(tag.id)} disabled={!canEdit} className="ml-1.5 -mr-1 p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-700 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
                                </button>
                            </span>
                        ) : null;
                    })}
                </div>
                 <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagInputKeyDown}
                    placeholder={canEdit ? "Add a tag..." : "Cannot add tags"}
                    disabled={!canEdit}
                    className="mt-2 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70"
                />
            </div>
          </>
        )}

        {item.type === ItemType.WorkPackage && item.title !== 'Inbox' && (
            <div className="space-y-1">
                <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Parent Work Package</label>
                <select value={(item as WorkPackage).parentId || ''} onChange={e => handleUpdate({ parentId: e.target.value || null })} disabled={!canEdit} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed">
                    <option value="">None</option>
                    {parentCandidateWorkPackages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
            </div>
        )}

        {workPackageItem && workPackageItem.title !== 'Inbox' && (
          <div className="space-y-4">
            {isAccountable && canEdit && (
                <button 
                    onClick={() => setIsClarificationModalOpen(true)} 
                    className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                    <ClipboardCheckIcon className="mr-2 -ml-1 h-5 w-5" />
                    Define Clarification
                </button>
             )}
            <button onClick={handleGenerateSubtasks} disabled={isGenerating || !canEdit} className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed">
              <SparklesIcon className="mr-2 -ml-1 h-5 w-5" />
              {isGenerating ? 'Generating...' : 'Generate Sub-tasks with AI'}
            </button>
            {aiError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{aiError}</p>}
          </div>
        )}
      </div>

       {workPackageItem && workPackageItem.title !== 'Inbox' && (
           <div className="px-6 pb-6">
              <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">Collaboration (RACI)</h3>
              <div className="p-4 bg-gray-100/50 dark:bg-gray-800/50 rounded-lg border border-border-light dark:border-border-dark space-y-4">
                  
                  <div>
                      <h4 className="font-semibold text-text-primary dark:text-text-primary-dark">Accountable (A)</h4>
                      <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-2">The one person ultimately answerable for the work.</p>
                      <select
                          value={workPackageItem.accountable || ''}
                          onChange={(e) => handleUpdate({ accountable: e.target.value || null })}
                          disabled={!canEdit}
                          className="w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                          <option value="">Not Assigned</option>
                          {allPersons.map(person => (
                              <option key={person.id} value={person.id}>{person.name}</option>
                          ))}
                      </select>
                  </div>

                  <MultiPersonRoleSection
                      role="responsible"
                      title="Responsible (R)"
                      description="The people who do the work."
                  />
                  
                   <MultiPersonRoleSection
                      role="consulted"
                      title="Consulted (C)"
                      description="People who provide input (for notification, edit and comment permission)."
                  />
                  
                   <MultiPersonRoleSection
                      role="informed"
                      title="Informed (I)"
                      description="People kept up-to-date (for notification, read-only)."
                  />
              </div>
          </div>
      )}


      <div className="p-4 border-t border-border-light dark:border-border-dark bg-background dark:bg-background-dark flex justify-between items-center text-xs text-text-secondary dark:text-text-secondary-dark">
        <span>Created: {new Date(item.createdAt).toLocaleDateString()}</span>
        <button onClick={() => onDelete(item.id)} disabled={!canEdit} className="text-red-500 hover:text-red-700 dark:hover:text-red-400 p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent">
          <TrashIcon />
        </button>
        <span>Updated: {new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
    {isClarificationModalOpen && workPackageItem && (
        <ClarificationModal
            workPackage={workPackageItem}
            onClose={() => setIsClarificationModalOpen(false)}
        />
    )}
    </>
  );
};
