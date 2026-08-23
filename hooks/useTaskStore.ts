import { useState, useEffect, useCallback } from 'react';
import { loadCollection, upsertDoc, deleteDocById, upsertMany, deleteManyById, allCollections } from '../services/localStore';
import { Item, Tag, AppData, ItemStatus, ItemType, WorkPackageType, Task, WorkPackage, Person, DefinitionOfDone, Project, Decision, PhaseType, KnowledgeGap, LogEntry, LogAction, DecisionStatus, TodayViewConfig, LeaveBlock, AiConfig, Routine, RecurrenceFrequency, RecurrenceRule, InboxFeedFilter, ApprovalRequest, ApprovalStatus } from '../types';

const createLogEntry = (log: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry => ({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...log,
});

const DEFAULT_AI_CONFIG: AiConfig = {
    taskGenerationMasterPrompt: "Act as expert project management, define steps and note in vietnamese for {taskName} for me. I am {userPrompt}. Output must include: steps, outcomes in list style",
    workPackageSubtaskGenerationMasterPrompt: "You are a world-class project manager. Your goal is to break down the following large work package into a list of small, actionable sub-tasks. Generate a list of sub-tasks for this work package. The tasks should be clear, concise, and actionable. Do not nest tasks. Just provide a flat list of task titles.",
    blockerTags: ['Thieu_thongtin', 'Thieu_thietbi', 'Thieu_giaopham', 'sai_lythuyet', 'sai_kynang'],
};

const getInitialData = (): AppData => ({
    items: [],
    tags: [],
    persons: [],
    projects: [],
    decisions: [],
    routines: [],
    logs: [],
    approvals: [],
    todayViewTagIds: [],
    todayViewConfig: { startHour: 8, endHour: 20, slotDuration: 60 },
    leaveBlocks: [],
    aiConfig: DEFAULT_AI_CONFIG,
    inboxFeedFilter: { assignments: true, collaborations: true, subtaskEvents: true },
    dismissedFeedItemIds: [],
});

// Helper to convert stored documents: local persistence keeps ISO strings as-is.
const fromStore = (docData: any): any => docData;

export const useTaskStore = (userId: string | null) => {
  const [data, setData] = useState<AppData>(getInitialData);
  const [isLoaded, setIsLoaded] = useState(false);

   useEffect(() => {
    if (!userId) {
        setData(getInitialData());
        setIsLoaded(false);
        return;
    }

    // Hydrate every collection from local persistence in one pass. There is no
    // network subscription to tear down, so no cleanup is needed.
    setData(prevData => {
        const hydrated = { ...prevData };
        for (const collectionName of allCollections()) {
            hydrated[collectionName] = fromStore(loadCollection(collectionName)) as never;
        }
        return hydrated;
    });

    setIsLoaded(true);
  }, [userId]);

  const addLogEntry = useCallback(async (log: Omit<LogEntry, 'id' | 'timestamp'>) => {
    const newLog = createLogEntry(log);
    try {
        upsertDoc('logs', newLog);
        setData(prevData => ({ ...prevData, logs: [...prevData.logs, newLog] }));
    } catch (error) {
        console.error("Error adding log entry: ", error);
    }
  }, []);


  const upsertItem = useCallback(async (itemData: Omit<Item, 'createdAt' | 'updatedAt'> | (Partial<Item> & { id: string }), actorId: string) => {
      const isUpdate = 'id' in itemData && data.items.some(i => i.id === itemData.id);
      const now = new Date().toISOString();
      let finalItem: Item;

      if (isUpdate) {
          const existingItem = data.items.find(i => i.id === itemData.id);
          finalItem = { ...existingItem, ...itemData, updatedAt: now } as Item;
      } else {
          finalItem = {
              id: crypto.randomUUID(),
              ...itemData,
              createdAt: now,
              updatedAt: now,
          } as Item;
      }
      
       upsertDoc('items', finalItem);
       setData(prevData => {
           const items = prevData.items.filter(i => i.id !== finalItem.id);
           return { ...prevData, items: [...items, finalItem] };
       });

       addLogEntry({
          userId: actorId,
          action: isUpdate ? LogAction.UPDATE : LogAction.CREATE,
          details: `${isUpdate ? 'Updated' : 'Created'} ${finalItem.type}: "${finalItem.title}"`,
          targetId: finalItem.id,
          targetType: finalItem.type,
      });

  }, [data.items, addLogEntry]);
  
  const getInbox = useCallback(() => {
    return data.items.find(item => item.type === ItemType.WorkPackage && item.title === 'Inbox') as WorkPackage | undefined;
  }, [data.items]);
  
  const ensureInboxExists = useCallback(async (uid: string) => {
      const inbox = getInbox();
      if (!inbox && uid) {
          const newInbox: Omit<WorkPackage, 'createdAt' | 'updatedAt'> = {
            id: crypto.randomUUID(),
            creatorId: uid,
            type: ItemType.WorkPackage,
            title: 'Inbox',
            note: 'A place to capture all your incoming tasks and ideas.',
            flagged: false,
            parentId: null,
            workPackageType: WorkPackageType.SingleActionList,
            status: ItemStatus.Active,
            completedAt: null,
            responsible: [],
            accountable: null,
            consulted: [],
            informed: [],
            plannedDeadline: null,
            definitionsOfDone: [],
            projectId: null,
          };
          await upsertItem(newInbox, uid);
      }
  }, [getInbox, upsertItem]);

  // When a user logs in, ensure they have an inbox
  useEffect(() => {
      if (userId && isLoaded) {
          ensureInboxExists(userId);
      }
  }, [userId, isLoaded, ensureInboxExists]);


  const batchCreateItems = useCallback(async (itemsToCreate: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>[], actorId: string, source: string = 'AI') => {
      const now = new Date().toISOString();

      const newItems: Item[] = itemsToCreate.map(itemData => ({
          ...itemData,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
      } as Item));

      upsertMany('items', newItems);
      setData(prevData => ({ ...prevData, items: [...prevData.items, ...newItems] }));

      addLogEntry({
          userId: actorId,
          action: LogAction.GENERATE,
          details: `${source} created ${newItems.length} item(s) in a batch operation.`,
          targetType: source,
      });

      return newItems;
  }, [addLogEntry]);

  const getDescendants = useCallback((itemId: string): Set<string> => {
    const descendants = new Set<string>();
    const queue: string[] = [itemId];
    const visited = new Set<string>([itemId]);
    const allItems = data.items;

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        const children = allItems.filter(item => item.parentId === currentId);
        
        for (const child of children) {
            if (!visited.has(child.id)) {
                descendants.add(child.id);
                visited.add(child.id);
                queue.push(child.id);
            }
        }
    }
    return descendants;
  }, [data.items]);

  const deleteItem = useCallback(async (id: string, actorId: string) => {
    const itemToDelete = data.items.find(i => i.id === id);
    if (!itemToDelete) return;

    const itemsToDeleteIds = Array.from<string>(getDescendants(id));
    itemsToDeleteIds.push(id);

    deleteManyById('items', itemsToDeleteIds);
    setData(prevData => ({ ...prevData, items: prevData.items.filter(i => !itemsToDeleteIds.includes(i.id)) }));

    addLogEntry({
        userId: actorId,
        action: LogAction.DELETE,
        details: `Deleted ${itemToDelete.type}: "${itemToDelete.title}" (and descendants)`,
        targetId: itemToDelete.id,
        targetType: itemToDelete.type,
      });

  }, [data.items, getDescendants, addLogEntry]);

  const addSubTasksToWorkPackage = useCallback(async (workPackageId: string, taskTitles: string[], creatorId: string) => {
        const now = new Date().toISOString();

        const newTasks: Task[] = taskTitles.map(title => ({
            id: crypto.randomUUID(),
            creatorId,
            title,
            note: '',
            type: ItemType.Task,
            workPackageId,
            parentId: null,
            tagIds: [],
            dueDate: null,
            deferDate: null,
            scheduledTime: null,
            estimate: null,
            completedAt: null,
            status: ItemStatus.Active,
            flagged: false,
            createdAt: now,
            updatedAt: now,
            isBlocked: false,
            blockageDetails: null,
            timerStartedAt: null,
            accumulatedTime: 0,
            assigneeId: null,
            collaboratorIds: [],
            clarificationNotes: '',
        }));

        upsertMany('items', newTasks);
        setData(prevData => ({ ...prevData, items: [...prevData.items, ...newTasks] }));

        const workPackage = data.items.find(i => i.id === workPackageId);
        addLogEntry({
            userId: creatorId,
            action: LogAction.GENERATE,
            details: `Generated ${newTasks.length} sub-tasks for "${workPackage?.title}"`,
            targetId: workPackageId,
            targetType: ItemType.WorkPackage,
        });

  }, [data.items, addLogEntry]);

  const upsertPerson = useCallback(async (person: Person, actorId: string) => {
    upsertDoc('persons', person);
    setData(prevData => {
        const persons = prevData.persons.filter(p => p.id !== person.id);
        return { ...prevData, persons: [...persons, person] };
    });

    addLogEntry({
          userId: actorId,
          action: data.persons.some(p => p.id === person.id) ? LogAction.UPDATE : LogAction.CREATE,
          details: `${data.persons.some(p => p.id === person.id) ? 'Updated' : 'Created'} Person: "${person.name}"`,
          targetId: person.id,
          targetType: 'Person'
      });
  }, [data.persons, addLogEntry]);

  const upsertTag = useCallback(async (tag: Tag, actorId: string) => {
    upsertDoc('tags', tag);
    setData(prevData => {
        const tags = prevData.tags.filter(t => t.id !== tag.id);
        return { ...prevData, tags: [...tags, tag] };
    });
    addLogEntry({
        userId: actorId,
        action: data.tags.some(t => t.id === tag.id) ? LogAction.UPDATE : LogAction.CREATE,
        details: `${data.tags.some(t => t.id === tag.id) ? 'Updated' : 'Created'} Tag: "${tag.name}"`,
        targetId: tag.id,
        targetType: 'Tag'
    });
  }, [data.tags, addLogEntry]);

  // Placeholder for functions not fully converted
  const notImpl = () => { alert("This feature is not fully wired up to local persistence yet.")};

  // --- Getters ---
  const getItems = useCallback(() => data.items, [data.items]);
  const getTags = useCallback(() => data.tags, [data.tags]);
  const getPersons = useCallback(() => data.persons, [data.persons]);
  const getProjects = useCallback(() => data.projects, [data.projects]);
  const getDecisions = useCallback(() => data.decisions, [data.decisions]);
  const getLogs = useCallback(() => data.logs, [data.logs]);
  const getItem = useCallback((id: string) => data.items.find(item => item.id === id), [data.items]);
  const getRoutines = useCallback(() => data.routines || [], [data.routines]);
  const getApprovals = useCallback(() => data.approvals || [], [data.approvals]);
  const getTodayViewTagIds = useCallback(() => data.todayViewTagIds || [], [data.todayViewTagIds]);
  const getTodayViewConfig = useCallback(() => data.todayViewConfig, [data.todayViewConfig]);
  const getAiConfig = useCallback(() => data.aiConfig || DEFAULT_AI_CONFIG, [data.aiConfig]);
  const getLeaveBlocks = useCallback(() => data.leaveBlocks || [], [data.leaveBlocks]);
  const getInboxFeedFilter = useCallback(() => data.inboxFeedFilter, [data.inboxFeedFilter]);
  const getDismissedFeedItemIds = useCallback(() => data.dismissedFeedItemIds, [data.dismissedFeedItemIds]);
  
  // --- Setters (persist locally) ---
  const setTodayViewTagIds = notImpl as (tagIds: string[]) => void;
  const setTodayViewConfig = notImpl as (config: TodayViewConfig) => void;
  const setAiConfig = notImpl as (config: AiConfig, actorId: string) => void;
  const upsertLeaveBlock = notImpl as (leaveBlock: LeaveBlock) => void;
  const deleteLeaveBlock = notImpl as (leaveBlockId: string) => void;
  const saveClarification = notImpl as any;
  const deleteTag = notImpl as (tagId: string, actorId: string) => void;
  const deletePerson = notImpl as (personId: string, actorId: string) => void;
  const upsertRoutine = notImpl as (routine: Partial<Routine> & { id: string }, actorId: string) => void;
  const deleteRoutine = notImpl as (routineId: string, actorId: string) => void;
  const upsertProject = notImpl as (projectData: Omit<Project, 'createdAt' | 'updatedAt' | 'creatorId'> | (Partial<Project> & { id: string }), actorId: string) => void;
  const deleteProject = notImpl as (projectId: string, actorId: string) => void;
  const upsertDecision = notImpl as (decisionData: Partial<Decision> & { id: string }, actorId: string) => void;
  const deleteDecision = notImpl as (decisionId: string, actorId: string) => void;
  const convertKnowledgeGapToWp = notImpl as (kg: KnowledgeGap, decisionId: string, projectId: string, actorId: string) => void;
  const convertDecisionToWp = notImpl as (decision: Decision, actorId: string) => void;
  const importData = notImpl as (type: 'tasks' | 'workPackages' | 'projects' | 'decisions', dataToImport: any[], actorId: string) => void;
  const setInboxFeedFilter = notImpl as (filter: InboxFeedFilter) => void;
  const dismissFeedItem = notImpl as (feedItemId: string) => void;
  const undismissAllFeedItems = notImpl as () => void;

  // --- Approval operations ---
  const requestApproval = useCallback(async (taskId: string, requesterId: string, approverId: string, reason?: string) => {
    const now = new Date().toISOString();
    const approval: ApprovalRequest = {
      id: crypto.randomUUID(),
      taskId,
      requesterId,
      approverId,
      status: ApprovalStatus.Pending,
      reason: reason || '',
      response: '',
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    upsertDoc('approvals', approval);
    setData(prevData => ({ ...prevData, approvals: [...prevData.approvals, approval] }));
    addLogEntry({
      userId: requesterId,
      action: LogAction.APPROVAL_REQUEST,
      details: `Approval requested for task`,
      targetId: taskId,
      targetType: 'Task',
    });
    return approval;
  }, [addLogEntry]);

  const resolveApproval = useCallback(async (approvalId: string, status: ApprovalStatus, actorId: string, response?: string) => {
    const now = new Date().toISOString();
    const existing = data.approvals.find(a => a.id === approvalId);
    if (!existing) return;
    const updated: ApprovalRequest = {
      ...existing,
      status,
      response: response || '',
      updatedAt: now,
      resolvedAt: now,
    };
    upsertDoc('approvals', updated);
    setData(prevData => ({
        ...prevData,
        approvals: prevData.approvals.map(a => (a.id === updated.id ? updated : a)),
    }));
    addLogEntry({
      userId: actorId,
      action: LogAction.APPROVAL_RESOLVE,
      details: `Approval ${status.toLowerCase()} for task`,
      targetId: existing.taskId,
      targetType: 'Task',
    });
  }, [data.approvals, addLogEntry]);

  // --- Org chart helpers ---
  const getApproverForPerson = useCallback((personId: string): Person | null => {
    const person = data.persons.find(p => p.id === personId);
    if (!person || !person.reportsTo) return null;
    return data.persons.find(p => p.id === person.reportsTo) || null;
  }, [data.persons]);

  const getReports = useCallback((personId: string): Person[] => {
    return data.persons.filter(p => p.reportsTo === personId);
  }, [data.persons]);

  return { getItems, getItem, getTags, getPersons, getInbox, getLogs, addLogEntry, upsertItem, deleteItem, addSubTasksToWorkPackage, upsertTag, deleteTag, getDescendants, upsertPerson, deletePerson, saveClarification, getProjects, getDecisions, upsertProject, deleteProject, upsertDecision, deleteDecision, convertKnowledgeGapToWp, convertDecisionToWp, getTodayViewTagIds, setTodayViewTagIds, getTodayViewConfig, setTodayViewConfig, getLeaveBlocks, upsertLeaveBlock, deleteLeaveBlock, getAiConfig, setAiConfig, importData, getRoutines, upsertRoutine, deleteRoutine, getInboxFeedFilter, setInboxFeedFilter, getDismissedFeedItemIds, dismissFeedItem, undismissAllFeedItems, batchCreateItems, isLoaded, getApprovals, requestApproval, resolveApproval, getApproverForPerson, getReports };
};

export type UseTaskStoreReturn = ReturnType<typeof useTaskStore>;