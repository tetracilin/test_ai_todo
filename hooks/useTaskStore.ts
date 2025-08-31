
import { useState, useEffect, useCallback, useRef } from 'react';
import { Item, Tag, AppData, ItemStatus, ItemType, WorkPackageType, Task, WorkPackage, Person, DefinitionOfDone, Project, Decision, PhaseType, KnowledgeGap, LogEntry, LogAction, DecisionStatus, TodayViewConfig, LeaveBlock, AiConfig, Routine, RecurrenceFrequency, RecurrenceRule, InboxFeedFilter } from '../types';

const APP_DATA_KEY = 'gemini-task-manager-data';

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

const getInitialData = (): AppData => {
  try {
    const savedData = localStorage.getItem(APP_DATA_KEY);
    if (savedData) {
      const parsed = JSON.parse(savedData);
      
      if (parsed && Array.isArray(parsed.persons) && parsed.persons.length > 0) {
        
        parsed.persons = parsed.persons.map((p: any) => ({
            ...p,
            email: p.email || '',
            mobile: p.mobile || '',
            aiPrompt: p.aiPrompt || '',
            passwordHash: p.passwordHash || undefined,
            securityQuestions: p.securityQuestions || [],
        }));

        parsed.items = (parsed.items || []).map((item: any) => {
            const baseItem = {
                ...item,
                creatorId: item.creatorId || (parsed.persons.length > 0 ? parsed.persons[0].id : ''),
                dodId: item.dodId || null,
            };

            if (item.type === ItemType.Task) {
                return {
                    ...baseItem,
                    isBlocked: item.isBlocked || false,
                    blockageDetails: item.blockageDetails || null,
                    timerStartedAt: item.timerStartedAt || null,
                    accumulatedTime: item.accumulatedTime || 0,
                    tagIds: item.tagIds || [],
                    assigneeId: item.assigneeId || null,
                    collaboratorIds: item.collaboratorIds || [],
                    clarificationNotes: item.clarificationNotes || '',
                    routineId: item.routineId || null,
                };
            }

            if(item.type === ItemType.WorkPackage) {
                const wp = baseItem as WorkPackage;
                return {
                    ...wp,
                    responsible: wp.responsible || [],
                    accountable: wp.accountable || null,
                    consulted: wp.consulted || [],
                    informed: wp.informed || [],
                    plannedDeadline: wp.plannedDeadline || null,
                    definitionsOfDone: (wp.definitionsOfDone || []).map((dod: any) => ({
                        ...dod,
                        workPackageId: dod.workPackageId || null,
                    })),
                    projectId: wp.projectId || null,
                };
            }
            return baseItem;
        });

        parsed.tags = parsed.tags || [];
        parsed.projects = parsed.projects || [];

        parsed.decisions = (parsed.decisions || []).map((d: any) => ({
            ...d,
            convertedToWpId: d.convertedToWpId || null,
            knowledgeGaps: (d.knowledgeGaps || []).map((kg: any) => ({
                ...kg,
                assigneeId: kg.assigneeId || (parsed.persons.length > 0 ? parsed.persons[0].id : ''),
            })),
            status: d.status || DecisionStatus.ToDo,
            plannedStartDate: d.plannedStartDate || null,
            plannedFinishDate: d.plannedFinishDate || null,
            actualStartDate: d.actualStartDate || null,
            actualFinishDate: d.actualFinishDate || null,
        }));
        
        parsed.logs = parsed.logs || [];
        parsed.routines = parsed.routines || [];
        parsed.todayViewTagIds = parsed.todayViewTagIds || [];
        parsed.todayViewConfig = parsed.todayViewConfig || { startHour: 8, endHour: 20, slotDuration: 60 };
        parsed.leaveBlocks = parsed.leaveBlocks || [];
        parsed.aiConfig = parsed.aiConfig || DEFAULT_AI_CONFIG;
        if (!parsed.aiConfig.blockerTags) {
            parsed.aiConfig.blockerTags = DEFAULT_AI_CONFIG.blockerTags;
        }
        parsed.inboxFeedFilter = parsed.inboxFeedFilter || { assignments: true, collaborations: true, subtaskEvents: true };
        parsed.dismissedFeedItemIds = parsed.dismissedFeedItemIds || [];

        
        return parsed;
      }
    }
  } catch (error) {
    console.error("Failed to parse data from localStorage", error);
  }

    // --- DEFAULT DATA FOR FIRST DEPLOYMENT ---
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const adminUser: Person = {
        id: crypto.randomUUID(),
        name: 'Admin User',
        email: 'admin@example.com',
        mobile: '111-111-1111',
        aiPrompt: 'a senior project manager with 20 years of experience in enterprise software.',
        passwordHash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', // 'password123'
        securityQuestions: [
            { question: "What was the name of your first pet?", answerHash: "5b9a014995f7547663168213693247184236315803539039a4891b7305941913" }, // 'Buddy'
            { question: "What city were you born in?", answerHash: "a358215a45218706348421bb463765490c6d7a42168175d7e489c31320edff84" }, // 'Metropolis'
        ]
    };

    const teamLeader: Person = {
        id: crypto.randomUUID(),
        name: 'Sarah Connor',
        email: 'sarah.c@example.com',
        mobile: '222-222-2222',
        aiPrompt: 'a pragmatic engineering team lead focused on delivery and team morale.',
        passwordHash: 'ef92b778bafe771e89245b89ecea4894ae404d317332ea3954531b677a2d483c', // 'password456'
        securityQuestions: [
            { question: "What was the name of your first pet?", answerHash: "1f8ac10f23c5b5bc1167bda84b833e9c558a4475874258608e84754421c9ff4c" }, // 'Pugsley'
            { question: "What city were you born in?", answerHash: "5799292a4f454055288a7a56577319e342817c897365f5735f4586d3b3de9399" }, // 'Los Angeles'
        ]
    };

    const engineer: Person = {
        id: crypto.randomUUID(),
        name: 'John Doe',
        email: 'john.d@example.com',
        mobile: '333-333-3333',
        aiPrompt: 'a junior full-stack engineer, eager to learn and contribute.',
        passwordHash: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', // 'password789'
        securityQuestions: [
            { question: "What was the name of your first pet?", answerHash: "d8d5918911018317a935574e47573f3458b998a69e46f663116a4a0808a28b03" }, // 'Max'
            { question: "What city were you born in?", answerHash: "66e7a450133642d0bc5f5358b548d4c98782065839071c5553b406b83b6f120e" }, // 'Chicago'
        ]
    };
    
    const persons = [adminUser, teamLeader, engineer];

    const project1: Project = {
        id: crypto.randomUUID(),
        creatorId: adminUser.id,
        name: "Mobile App Redesign",
        code: "MAR-2024",
        contractId: "C-12345",
        status: "In Progress",
        phases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    
    const decision1: Decision = {
        id: crypto.randomUUID(),
        creatorId: teamLeader.id,
        title: "Select UI Framework",
        projectId: project1.id,
        parentId: null,
        knowledgeGaps: [
            { id: crypto.randomUUID(), title: "Performance comparison on older devices", assigneeId: engineer.id, decisionId: '', convertedToWpId: null },
            { id: crypto.randomUUID(), title: "Long-term maintenance costs", assigneeId: teamLeader.id, decisionId: '', convertedToWpId: null },
        ],
        convertedToWpId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: DecisionStatus.OnGoing,
        plannedStartDate: today.toISOString(),
        plannedFinishDate: tomorrow.toISOString(),
        actualStartDate: null,
        actualFinishDate: null,
    };
    decision1.knowledgeGaps.forEach(kg => kg.decisionId = decision1.id);

    const decision2: Decision = {
        id: crypto.randomUUID(),
        creatorId: engineer.id,
        title: "Evaluate React Native vs. Flutter",
        projectId: project1.id,
        parentId: decision1.id,
        knowledgeGaps: [],
        convertedToWpId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: DecisionStatus.ToDo,
        plannedStartDate: null,
        plannedFinishDate: null,
        actualStartDate: null,
        actualFinishDate: null,
    };

    const inboxWp: WorkPackage = {
        id: crypto.randomUUID(),
        creatorId: adminUser.id,
        type: ItemType.WorkPackage,
        title: 'Inbox',
        note: 'A place to capture all your incoming tasks and ideas.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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

    const wp1: WorkPackage = {
        id: crypto.randomUUID(),
        creatorId: teamLeader.id,
        title: "Phase 1: Research & Discovery",
        note: "Initial research and competitor analysis.",
        type: ItemType.WorkPackage,
        parentId: null,
        workPackageType: WorkPackageType.Sequential,
        status: ItemStatus.Active,
        completedAt: null,
        responsible: [engineer.id],
        accountable: teamLeader.id,
        consulted: [adminUser.id],
        informed: [],
        flagged: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectId: project1.id,
    };

    const wp2: WorkPackage = {
        id: crypto.randomUUID(),
        creatorId: teamLeader.id,
        title: "Phase 2: UI/UX Design",
        note: "Wireframes, mockups, and prototypes.",
        type: ItemType.WorkPackage,
        parentId: null,
        workPackageType: WorkPackageType.Parallel,
        status: ItemStatus.Active,
        completedAt: null,
        responsible: [engineer.id, teamLeader.id],
        accountable: teamLeader.id,
        consulted: [],
        informed: [],
        flagged: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectId: project1.id,
    };
    
    const tagHighPriority: Tag = { id: crypto.randomUUID(), name: 'High Priority' };
    const tagResearch: Tag = { id: crypto.randomUUID(), name: 'Research' };
    const tagDesign: Tag = { id: crypto.randomUUID(), name: 'Design' };

    const taskInbox1: Task = {
        id: crypto.randomUUID(),
        creatorId: adminUser.id,
        title: "Organize team drive",
        note: "Create folders for project MAR-2024.",
        type: ItemType.Task,
        workPackageId: inboxWp.id,
        parentId: null, tagIds: [], dueDate: null, deferDate: null, scheduledTime: null, estimate: 30, completedAt: null, status: ItemStatus.Active, flagged: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isBlocked: false, blockageDetails: null, timerStartedAt: null, accumulatedTime: 0, assigneeId: adminUser.id, collaboratorIds: [], clarificationNotes: '',
    };
    
    const taskWp1_1: Task = {
        id: crypto.randomUUID(),
        creatorId: teamLeader.id,
        title: "Analyze top 3 competitor apps",
        note: "Focus on user flow and feature set.",
        type: ItemType.Task,
        workPackageId: wp1.id,
        parentId: null, tagIds: [tagResearch.id], dueDate: null, deferDate: null, scheduledTime: null, estimate: 120, completedAt: null, status: ItemStatus.Active, flagged: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isBlocked: false, blockageDetails: null, timerStartedAt: null, accumulatedTime: 0, assigneeId: engineer.id, collaboratorIds: [teamLeader.id], clarificationNotes: '',
    };
    
    const taskWp2_1: Task = {
        id: crypto.randomUUID(),
        creatorId: teamLeader.id,
        title: "Create wireframes for login screen",
        note: "Include social login options.",
        type: ItemType.Task,
        workPackageId: wp2.id,
        parentId: null, tagIds: [tagDesign.id, tagHighPriority.id], dueDate: today.toISOString(), deferDate: null, scheduledTime: "10:00", estimate: 60, completedAt: null, status: ItemStatus.Active, flagged: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isBlocked: false, blockageDetails: null, timerStartedAt: null, accumulatedTime: 0, assigneeId: engineer.id, collaboratorIds: [], clarificationNotes: '',
    };
    
    const taskWp2_2_subtask: Task = {
        id: crypto.randomUUID(),
        creatorId: engineer.id,
        title: "Get feedback on wireframes",
        note: "Schedule a meeting with Sarah.",
        type: ItemType.Task,
        workPackageId: wp2.id,
        parentId: taskWp2_1.id, tagIds: [tagDesign.id], dueDate: today.toISOString(), deferDate: null, scheduledTime: "14:00", estimate: 30, completedAt: null, status: ItemStatus.Active, flagged: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isBlocked: false, blockageDetails: null, timerStartedAt: null, accumulatedTime: 0, assigneeId: teamLeader.id, collaboratorIds: [], clarificationNotes: '',
    };

    const taskWp2_3: Task = {
        id: crypto.randomUUID(),
        creatorId: teamLeader.id,
        title: "Design color palette",
        note: "Must be accessible (WCAG AA).",
        type: ItemType.Task,
        workPackageId: wp2.id,
        parentId: null, tagIds: [tagDesign.id], dueDate: tomorrow.toISOString(), deferDate: null, scheduledTime: null, estimate: 90, completedAt: null, status: ItemStatus.Active, flagged: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isBlocked: false, blockageDetails: null, timerStartedAt: null, accumulatedTime: 0, assigneeId: engineer.id, collaboratorIds: [], clarificationNotes: '',
    };
    
    const leaveBlock: LeaveBlock = {
        id: crypto.randomUUID(),
        creatorId: adminUser.id,
        date: today.toISOString().split('T')[0],
        title: 'Team Lunch',
        startTime: '12:00',
        endTime: '13:00',
    };

    const dailyRoutine: Routine = {
        id: crypto.randomUUID(),
        creatorId: adminUser.id,
        title: "Daily stand-up check-in",
        note: "Prepare topics for the daily stand-up meeting.",
        tagIds: [],
        estimate: 15,
        assigneeId: adminUser.id,
        recurrenceRule: {
            frequency: RecurrenceFrequency.Daily
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    return {
        items: [inboxWp, wp1, wp2, taskInbox1, taskWp1_1, taskWp2_1, taskWp2_2_subtask, taskWp2_3],
        tags: [tagHighPriority, tagResearch, tagDesign],
        persons,
        projects: [project1],
        decisions: [decision1, decision2],
        routines: [dailyRoutine],
        logs: [],
        todayViewTagIds: [],
        todayViewConfig: { startHour: 8, endHour: 20, slotDuration: 60 },
        leaveBlocks: [leaveBlock],
        aiConfig: DEFAULT_AI_CONFIG,
        inboxFeedFilter: { assignments: true, collaborations: true, subtaskEvents: true },
        dismissedFeedItemIds: [],
    };
};


export const useTaskStore = () => {
  const [data, setData] = useState<AppData>(getInitialData);
  const hasInitializedRoutines = useRef(false);

  useEffect(() => {
    localStorage.setItem(APP_DATA_KEY, JSON.stringify(data));
  }, [data]);

  const generateTasksFromRoutines = useCallback(() => {
        setData(prevData => {
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Normalize to start of day
            const todayStr = today.toISOString().split('T')[0];
            const inbox = prevData.items.find(item => item.type === ItemType.WorkPackage && item.title === 'Inbox') as WorkPackage | undefined;
            if (!inbox) return prevData;

            let wasModified = false;
            const newTasks: Task[] = [];
            const newLogs: LogEntry[] = [];

            const updatedRoutines = prevData.routines.map(routine => {
                const lastGeneratedDate = routine.lastGeneratedForDate ? new Date(routine.lastGeneratedForDate.split('T')[0]) : null;

                if (lastGeneratedDate && lastGeneratedDate.getTime() >= today.getTime()) {
                    return routine;
                }

                let shouldRun = false;
                const rule = routine.recurrenceRule;
                if (rule.frequency === RecurrenceFrequency.Daily) {
                    shouldRun = true;
                } else if (rule.frequency === RecurrenceFrequency.Weekly) {
                    if (rule.daysOfWeek?.includes(today.getDay())) {
                        shouldRun = true;
                    }
                }
                
                if (shouldRun) {
                    wasModified = true;
                    const now = new Date().toISOString();
                    const newTask: Task = {
                        id: crypto.randomUUID(),
                        creatorId: routine.creatorId,
                        title: routine.title,
                        note: routine.note,
                        type: ItemType.Task,
                        workPackageId: inbox.id,
                        parentId: null,
                        tagIds: routine.tagIds,
                        dueDate: today.toISOString(),
                        deferDate: null,
                        scheduledTime: null,
                        estimate: routine.estimate,
                        completedAt: null,
                        status: ItemStatus.Active,
                        flagged: false,
                        createdAt: now,
                        updatedAt: now,
                        isBlocked: false,
                        blockageDetails: null,
                        timerStartedAt: null,
                        accumulatedTime: 0,
                        assigneeId: routine.assigneeId,
                        collaboratorIds: [],
                        clarificationNotes: '',
                        routineId: routine.id,
                    };
                    newTasks.push(newTask);
                    
                    return { ...routine, lastGeneratedForDate: todayStr };
                }
                return routine;
            });

            if (wasModified) {
                const log = createLogEntry({
                    userId: 'SYSTEM',
                    action: LogAction.ROUTINE_GENERATE,
                    details: `Generated ${newTasks.length} task(s) from routines.`
                });
                newLogs.push(log);
                
                return {
                    ...prevData,
                    items: [...prevData.items, ...newTasks],
                    routines: updatedRoutines,
                    logs: [...newLogs, ...(prevData.logs || [])]
                };
            }
            
            return prevData;
        });
    }, []);

    useEffect(() => {
        if (!hasInitializedRoutines.current) {
            generateTasksFromRoutines();
            hasInitializedRoutines.current = true;
        }
    }, [generateTasksFromRoutines]);
  
  const getItems = useCallback(() => data.items, [data.items]);
  const getTags = useCallback(() => data.tags, [data.tags]);
  const getPersons = useCallback(() => data.persons, [data.persons]);
  const getProjects = useCallback(() => data.projects, [data.projects]);
  const getDecisions = useCallback(() => data.decisions, [data.decisions]);
  const getLogs = useCallback(() => data.logs, [data.logs]);
  const getRoutines = useCallback(() => data.routines || [], [data.routines]);
  const getTodayViewTagIds = useCallback(() => data.todayViewTagIds || [], [data.todayViewTagIds]);

  const setTodayViewTagIds = useCallback((tagIds: string[]) => {
    setData(prevData => ({
        ...prevData,
        todayViewTagIds: tagIds,
    }));
  }, []);

  const getTodayViewConfig = useCallback(() => data.todayViewConfig, [data.todayViewConfig]);
  const setTodayViewConfig = useCallback((config: TodayViewConfig) => {
    setData(prevData => ({
      ...prevData,
      todayViewConfig: config,
    }));
  }, []);

  const getAiConfig = useCallback(() => data.aiConfig || DEFAULT_AI_CONFIG, [data.aiConfig]);
  const setAiConfig = useCallback((config: AiConfig, actorId: string) => {
    setData(prevData => {
        const log = createLogEntry({
            userId: actorId,
            action: LogAction.UPDATE,
            details: `Updated AI Configuration`,
            targetType: 'AIConfig'
        });
        return {
            ...prevData,
            aiConfig: config,
            logs: [log, ...(prevData.logs || [])]
        };
    });
  }, []);

  const getLeaveBlocks = useCallback(() => data.leaveBlocks || [], [data.leaveBlocks]);
  const upsertLeaveBlock = useCallback((leaveBlock: LeaveBlock) => {
    setData(prevData => {
      const newBlocks = [...(prevData.leaveBlocks || [])];
      const index = newBlocks.findIndex(b => b.id === leaveBlock.id);
      if (index > -1) {
        newBlocks[index] = leaveBlock;
      } else {
        newBlocks.push(leaveBlock);
      }
      return { ...prevData, leaveBlocks: newBlocks };
    });
  }, []);

  const deleteLeaveBlock = useCallback((leaveBlockId: string) => {
    setData(prevData => ({
      ...prevData,
      leaveBlocks: (prevData.leaveBlocks || []).filter(b => b.id !== leaveBlockId),
    }));
  }, []);


  const addLogEntry = useCallback((log: Omit<LogEntry, 'id' | 'timestamp'>) => {
    setData(prevData => {
        const newLog = createLogEntry(log);
        return {
            ...prevData,
            logs: [newLog, ...(prevData.logs || [])]
        };
    });
  }, []);

  const getItem = useCallback((id: string) => data.items.find(item => item.id === id), [data.items]);
  
  const getInbox = useCallback(() => {
    return data.items.find(item => item.type === ItemType.WorkPackage && item.title === 'Inbox') as WorkPackage | undefined;
  }, [data.items]);
  
  const upsertItem = useCallback((itemData: Omit<Item, 'createdAt' | 'updatedAt'> | (Partial<Item> & { id: string }), actorId: string) => {
    setData(prevData => {
      const now = new Date().toISOString();
      const allItems = [...prevData.items];
      const index = allItems.findIndex(i => i.id === itemData.id);
      const isUpdate = index > -1;
      let itemToUpdate: Item;

      if (isUpdate) {
        itemToUpdate = { ...allItems[index], ...itemData, updatedAt: now } as Item;
        allItems[index] = itemToUpdate;
      } else {
        if (!('creatorId' in itemData)) {
            console.error("A new item must have a creatorId.");
            return prevData;
        }
        itemToUpdate = { createdAt: now, updatedAt: now, ...itemData } as Item;
        allItems.push(itemToUpdate);
      }

      // Propagate work package ID for tasks and subtasks
      if (itemToUpdate.type === ItemType.Task) {
        const taskToUpdate = itemToUpdate as Task;
        let finalWorkPackageId = taskToUpdate.workPackageId;

        if (taskToUpdate.parentId) {
          const parentTask = allItems.find(i => i.id === taskToUpdate.parentId && i.type === ItemType.Task) as Task | undefined;
          if (parentTask) {
            finalWorkPackageId = parentTask.workPackageId;
          }
        }
        
        if(taskToUpdate.workPackageId !== finalWorkPackageId) {
            taskToUpdate.workPackageId = finalWorkPackageId;
        }

        const queue: string[] = [taskToUpdate.id];
        const visited = new Set<string>([taskToUpdate.id]);

        while (queue.length > 0) {
          const currentId = queue.shift()!;
          
          for (let i = 0; i < allItems.length; i++) {
              const currentItem = allItems[i];
              if (currentItem.type === ItemType.Task && currentItem.parentId === currentId) {
                  const childTask = currentItem as Task;
                  if (!visited.has(childTask.id)) {
                      visited.add(childTask.id);
                      queue.push(childTask.id);
                      
                      if (childTask.workPackageId !== finalWorkPackageId) {
                           allItems[i] = { ...childTask, workPackageId: finalWorkPackageId };
                      }
                  }
              }
          }
        }
      }

      const log = createLogEntry({
          userId: actorId,
          action: isUpdate ? LogAction.UPDATE : LogAction.CREATE,
          details: `${isUpdate ? 'Updated' : 'Created'} ${itemToUpdate.type}: "${itemToUpdate.title}"`,
          targetId: itemToUpdate.id,
          targetType: itemToUpdate.type,
      });

      return { ...prevData, items: allItems, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const batchCreateItems = useCallback((itemsToCreate: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>[], actorId: string, source: string = 'AI') => {
    setData(prevData => {
        const now = new Date().toISOString();
        const newItems: Item[] = itemsToCreate.map(itemData => ({
            ...itemData,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
        } as Item));
        
        const log = createLogEntry({
            userId: actorId,
            action: LogAction.GENERATE,
            details: `${source} created ${newItems.length} item(s) in a batch operation.`,
            targetType: source,
        });
        
        return {
            ...prevData,
            items: [...prevData.items, ...newItems],
            logs: [log, ...(prevData.logs || [])],
        };
    });
  }, []);

  const deleteItem = useCallback((id: string, actorId: string) => {
    setData(prevData => {
      const itemToDelete = prevData.items.find(i => i.id === id);
      if (!itemToDelete) return prevData;

      const allItems = prevData.items;
      const itemsToDeleteSet = new Set<string>();
      const queue: string[] = [id];
      itemsToDeleteSet.add(id);

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const item = allItems.find(i => i.id === currentId);
        if (!item) continue;

        allItems.forEach(child => {
            if (child.parentId === currentId) {
                if (!itemsToDeleteSet.has(child.id)) {
                    itemsToDeleteSet.add(child.id);
                    queue.push(child.id);
                }
            }
        });

        if (item.type === ItemType.WorkPackage) {
          allItems.forEach(child => {
            if (child.type === ItemType.Task && child.workPackageId === currentId) {
              if (!itemsToDeleteSet.has(child.id)) {
                itemsToDeleteSet.add(child.id);
                queue.push(child.id);
              }
            }
          });
        }
      }

      const newItems = allItems.filter(i => !itemsToDeleteSet.has(i.id));
      
      const log = createLogEntry({
        userId: actorId,
        action: LogAction.DELETE,
        details: `Deleted ${itemToDelete.type}: "${itemToDelete.title}" (and descendants)`,
        targetId: itemToDelete.id,
        targetType: itemToDelete.type,
      });

      return { ...prevData, items: newItems, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const addSubTasksToWorkPackage = useCallback((workPackageId: string, taskTitles: string[], creatorId: string) => {
    setData(prevData => {
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

        const workPackage = prevData.items.find(i => i.id === workPackageId);
        const log = createLogEntry({
            userId: creatorId,
            action: LogAction.GENERATE,
            details: `Generated ${taskTitles.length} sub-tasks for "${workPackage?.title}"`,
            targetId: workPackageId,
            targetType: ItemType.WorkPackage,
        });

        return {
            ...prevData,
            items: [...prevData.items, ...newTasks],
            logs: [log, ...(prevData.logs || [])],
        };
    });
  }, []);
    
  const saveClarification = useCallback((
    workPackage: WorkPackage,
    plannedDeadline: string | null,
    dods: (DefinitionOfDone & { newSubWpTitle?: string })[],
    actorId: string,
  ) => {
    setData(prevData => {
        let newItems = [...prevData.items];
        const now = new Date().toISOString();
        const finalDods: DefinitionOfDone[] = [];
        const newLogs: LogEntry[] = [];

        const dodIdsForThisWp = new Set(workPackage.definitionsOfDone?.map(d => d.id) || []);
        dods.forEach(d => dodIdsForThisWp.add(d.id));

        newItems = newItems.filter(item => 
            !(item.type === ItemType.Task && item.dodId && dodIdsForThisWp.has(item.dodId))
        );

        for (const dod of dods) {
            let taskWorkPackageId = dod.workPackageId || workPackage.id;
            const dodForStorage: DefinitionOfDone = {
                id: dod.id,
                text: dod.text,
                assigneeId: dod.assigneeId,
                requirements: dod.requirements,
                workPackageId: dod.workPackageId,
            };

            if (dod.newSubWpTitle && !dod.workPackageId) {
                const newSubWp: WorkPackage = {
                    id: crypto.randomUUID(),
                    creatorId: actorId,
                    parentId: workPackage.id,
                    title: dod.newSubWpTitle,
                    note: `Sub-work package for DoD: "${dod.text}"`,
                    type: ItemType.WorkPackage,
                    workPackageType: WorkPackageType.Parallel,
                    status: ItemStatus.Active,
                    flagged: false,
                    createdAt: now,
                    updatedAt: now,
                    completedAt: null,
                    accountable: dod.assigneeId || workPackage.accountable,
                    responsible: dod.assigneeId ? [dod.assigneeId] : [],
                    consulted: [],
                    informed: [],
                    projectId: workPackage.projectId,
                };
                newItems.push(newSubWp);
                taskWorkPackageId = newSubWp.id;
                dodForStorage.workPackageId = newSubWp.id;
            }

            for (const req of dod.requirements) {
                const newTask: Task = {
                    id: crypto.randomUUID(),
                    creatorId: actorId,
                    title: req.text,
                    note: '',
                    type: ItemType.Task,
                    workPackageId: taskWorkPackageId,
                    parentId: null,
                    tagIds: [],
                    dueDate: null,
                    deferDate: null,
                    scheduledTime: null,
                    estimate: null,
                    completedAt: req.completed ? now : null,
                    status: req.completed ? ItemStatus.Completed : ItemStatus.Active,
                    flagged: false,
                    createdAt: now,
                    updatedAt: now,
                    dodId: dod.id,
                    isBlocked: false,
                    blockageDetails: null,
                    timerStartedAt: null,
                    accumulatedTime: 0,
                    assigneeId: dod.assigneeId || null,
                    collaboratorIds: [],
                    clarificationNotes: '',
                };
                newItems.push(newTask);
            }
            finalDods.push(dodForStorage);
        }

        const wpIndex = newItems.findIndex(item => item.id === workPackage.id);
        if (wpIndex > -1) {
            const updatedWp = {
                ...newItems[wpIndex],
                plannedDeadline: plannedDeadline,
                definitionsOfDone: finalDods,
                updatedAt: now,
            };
            newItems[wpIndex] = updatedWp as Item;
        }

        const log = createLogEntry({
            userId: actorId,
            action: LogAction.CLARIFY,
            details: `Updated clarification for Work Package: "${workPackage.title}"`,
            targetId: workPackage.id,
            targetType: ItemType.WorkPackage,
        });
        newLogs.push(log);

        return { ...prevData, items: newItems, logs: [...newLogs, ...(prevData.logs || [])] };
    });
  }, []);

  const upsertTag = useCallback((tag: Tag, actorId: string) => {
    setData(prevData => {
      const index = prevData.tags.findIndex(t => t.id === tag.id);
      const isUpdate = index > -1;
      const newTags = [...prevData.tags];

      if (isUpdate) {
        newTags[index] = tag;
      } else {
        newTags.push(tag);
      }
      
      const log = createLogEntry({
          userId: actorId,
          action: isUpdate ? LogAction.UPDATE : LogAction.CREATE,
          details: `${isUpdate ? 'Updated' : 'Created'} Tag: "${tag.name}"`,
          targetId: tag.id,
          targetType: 'Tag'
      });
      
      return { ...prevData, tags: newTags, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const deleteTag = useCallback((tagId: string, actorId: string) => {
      setData(prevData => {
          const tagToDelete = prevData.tags.find(t => t.id === tagId);
          if (!tagToDelete) return prevData;
          
          const newTags = prevData.tags.filter(t => t.id !== tagId);
          const newItems = prevData.items.map(item => {
              if (item.type === ItemType.Task && item.tagIds.includes(tagId)) {
                  return { ...item, tagIds: item.tagIds.filter(id => id !== tagId) };
              }
              return item;
          });

          const log = createLogEntry({
              userId: actorId,
              action: LogAction.DELETE,
              details: `Deleted Tag: "${tagToDelete.name}"`,
              targetId: tagId,
              targetType: 'Tag'
          });

          return { ...prevData, items: newItems as Item[], tags: newTags, logs: [log, ...(prevData.logs || [])] };
      });
  }, []);
    
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

  const upsertPerson = useCallback((person: Person, actorId: string) => {
    setData(prevData => {
      const index = prevData.persons.findIndex(p => p.id === person.id);
      const isUpdate = index > -1;
      const newPersons = [...prevData.persons];

      if (isUpdate) {
        newPersons[index] = person;
      } else {
        newPersons.push(person);
      }
      
      const log = createLogEntry({
          userId: actorId,
          action: isUpdate ? LogAction.UPDATE : LogAction.CREATE,
          details: `${isUpdate ? 'Updated' : 'Created'} Person: "${person.name}"`,
          targetId: person.id,
          targetType: 'Person'
      });

      return { ...prevData, persons: newPersons, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const deletePerson = useCallback((personId: string, actorId: string) => {
    setData(prevData => {
      const personToDelete = prevData.persons.find(p => p.id === personId);
      if (!personToDelete) return prevData;
      
      const newPersons = prevData.persons.filter(p => p.id !== personId);
      
      const newItems = prevData.items.map(item => {
        let updated = false;
        const newItem = { ...item };
        
        if (newItem.type === ItemType.WorkPackage) {
          const wp = newItem as WorkPackage;

          if (wp.accountable === personId) {
            wp.accountable = null;
            updated = true;
          }
          if (wp.responsible.includes(personId)) {
            wp.responsible = wp.responsible.filter(id => id !== personId);
            updated = true;
          }
          if (wp.consulted.includes(personId)) {
            wp.consulted = wp.consulted.filter(id => id !== personId);
            updated = true;
          }
          if (wp.informed.includes(personId)) {
            wp.informed = wp.informed.filter(id => id !== personId);
            updated = true;
          }
          
          if (wp.definitionsOfDone) {
              const newDods = wp.definitionsOfDone.map(dod => {
                  if (dod.assigneeId === personId) {
                      return { ...dod, assigneeId: '' };
                  }
                  return dod;
              });
              wp.definitionsOfDone = newDods;
              updated = true;
          }
        } else if (newItem.type === ItemType.Task) {
            const task = newItem as Task;
            if (task.assigneeId === personId) {
                task.assigneeId = null;
                updated = true;
            }
            if (task.collaboratorIds?.includes(personId)) {
                task.collaboratorIds = task.collaboratorIds.filter(id => id !== personId);
                updated = true;
            }
        }
        
        if (updated) return newItem;
        return item;
      });

       const log = createLogEntry({
          userId: actorId,
          action: LogAction.DELETE,
          details: `Deleted Person: "${personToDelete.name}"`,
          targetId: personId,
          targetType: 'Person'
      });

      return { ...prevData, items: newItems as Item[], persons: newPersons, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const upsertRoutine = useCallback((routine: Partial<Routine> & { id: string }, actorId: string) => {
    setData(prevData => {
        const now = new Date().toISOString();
        const allRoutines = [...(prevData.routines || [])];
        const index = allRoutines.findIndex(r => r.id === routine.id);
        const isUpdate = index > -1;
        let finalRoutine: Routine;

        if (isUpdate) {
            finalRoutine = { ...allRoutines[index], ...routine, updatedAt: now } as Routine;
            allRoutines[index] = finalRoutine;
        } else {
            finalRoutine = {
                creatorId: actorId,
                createdAt: now,
                updatedAt: now,
                note: '',
                tagIds: [],
                estimate: null,
                assigneeId: null,
                ...routine,
            } as Routine;
            allRoutines.push(finalRoutine);
        }

        const log = createLogEntry({
          userId: actorId,
          action: isUpdate ? LogAction.UPDATE : LogAction.CREATE,
          details: `${isUpdate ? 'Updated' : 'Created'} Routine: "${finalRoutine.title}"`,
          targetId: finalRoutine.id,
          targetType: 'Routine'
        });

        return { ...prevData, routines: allRoutines, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const deleteRoutine = useCallback((routineId: string, actorId: string) => {
    setData(prevData => {
        const routineToDelete = prevData.routines.find(r => r.id === routineId);
        if (!routineToDelete) return prevData;

        const log = createLogEntry({
            userId: actorId,
            action: LogAction.DELETE,
            details: `Deleted Routine: "${routineToDelete.title}"`,
            targetId: routineId,
            targetType: 'Routine'
        });

        return {
            ...prevData,
            routines: prevData.routines.filter(r => r.id !== routineId),
            logs: [log, ...(prevData.logs || [])]
        };
    });
  }, []);


  // --- Project Management ---
  const upsertProject = useCallback((projectData: Omit<Project, 'createdAt' | 'updatedAt' | 'creatorId'> | (Partial<Project> & { id: string }), actorId: string) => {
    setData(prevData => {
        const now = new Date().toISOString();
        const allProjects = [...prevData.projects];
        const index = allProjects.findIndex(p => p.id === projectData.id);
        const isUpdate = index > -1;
        let finalProject: Project;

        if (isUpdate) {
            finalProject = { ...allProjects[index], ...projectData, updatedAt: now } as Project;
            allProjects[index] = finalProject;
        } else {
            finalProject = { ...projectData, id: crypto.randomUUID(), creatorId: actorId, createdAt: now, updatedAt: now } as Project;
            allProjects.push(finalProject);
        }

        const log = createLogEntry({
          userId: actorId,
          action: isUpdate ? LogAction.UPDATE : LogAction.CREATE,
          details: `${isUpdate ? 'Updated' : 'Created'} Project: "${finalProject.name}"`,
          targetId: finalProject.id,
          targetType: 'Project'
        });

        return { ...prevData, projects: allProjects, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const deleteProject = useCallback((projectId: string, actorId: string) => {
    setData(prevData => {
        const projectToDelete = prevData.projects.find(p => p.id === projectId);
        if (!projectToDelete) return prevData;

        const log = createLogEntry({
            userId: actorId,
            action: LogAction.DELETE,
            details: `Deleted Project: "${projectToDelete.name}"`,
            targetId: projectId,
            targetType: 'Project'
        });

        return {
            ...prevData,
            projects: prevData.projects.filter(p => p.id !== projectId),
            decisions: prevData.decisions.filter(d => d.projectId !== projectId),
            items: prevData.items.map(i => {
                if (i.type === ItemType.WorkPackage && i.projectId === projectId) {
                    return { ...i, projectId: null };
                }
                return i;
            }),
            logs: [log, ...(prevData.logs || [])]
        };
    });
  }, []);
    
  // --- Decision Management ---
  const upsertDecision = useCallback((decisionData: Partial<Decision> & { id: string }, actorId: string) => {
    setData(prevData => {
        const now = new Date().toISOString();
        const allDecisions = [...prevData.decisions];
        const index = allDecisions.findIndex(d => d.id === decisionData.id);
        const isUpdate = index > -1;
        let finalDecision: Decision;

        if (isUpdate) {
            finalDecision = { ...allDecisions[index], ...decisionData, updatedAt: now } as Decision;
            allDecisions[index] = finalDecision;
        } else {
            finalDecision = {
                creatorId: actorId,
                createdAt: now,
                updatedAt: now,
                status: DecisionStatus.ToDo,
                plannedStartDate: null,
                plannedFinishDate: null,
                actualStartDate: null,
                actualFinishDate: null,
                knowledgeGaps: [],
                convertedToWpId: null,
                parentId: null,
                projectId: '',
                ...decisionData,
            } as Decision;
            allDecisions.push(finalDecision);
        }
        
        // Validation logic
        if (finalDecision.plannedFinishDate) {
            // 1. Check against parent
            if (finalDecision.parentId) {
                const parent = allDecisions.find(d => d.id === finalDecision.parentId);
                if (parent && parent.plannedFinishDate) {
                    if (new Date(finalDecision.plannedFinishDate) > new Date(parent.plannedFinishDate)) {
                        alert(`Warning: The sub-decision's planned finish date (${new Date(finalDecision.plannedFinishDate).toLocaleDateString()}) is later than its parent's planned finish date (${new Date(parent.plannedFinishDate).toLocaleDateString()}).`);
                    }
                }
            }

            // 2. Check against children
            const descendants = new Set<string>();
            const queue: string[] = [finalDecision.id];
            const visited = new Set<string>([finalDecision.id]);

            while(queue.length > 0) {
                const currentId = queue.shift()!;
                for (const d of allDecisions) {
                    if (d.parentId === currentId && !visited.has(d.id)) {
                        descendants.add(d.id);
                        visited.add(d.id);
                        queue.push(d.id);
                    }
                }
            }
            
            for (const descId of descendants) {
                const child = allDecisions.find(d => d.id === descId);
                if (child && child.plannedFinishDate) {
                     if (new Date(child.plannedFinishDate) > new Date(finalDecision.plannedFinishDate!)) {
                        alert(`Warning: This decision's new planned finish date (${new Date(finalDecision.plannedFinishDate!).toLocaleDateString()}) is earlier than its sub-decision "${child.title}" (${new Date(child.plannedFinishDate).toLocaleDateString()}).`);
                        break; // one alert is enough
                    }
                }
            }
        }
        
        const log = createLogEntry({
          userId: actorId,
          action: isUpdate ? LogAction.UPDATE : LogAction.CREATE,
          details: `${isUpdate ? 'Updated' : 'Created'} Decision: "${finalDecision.title}"`,
          targetId: finalDecision.id,
          targetType: 'Decision'
        });
        
        return { ...prevData, decisions: allDecisions, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const deleteDecision = useCallback((decisionId: string, actorId: string) => {
    setData(prevData => {
        const decisionToDelete = prevData.decisions.find(d => d.id === decisionId);
        if(!decisionToDelete) return prevData;

        // Find all descendants to delete them as well (cascading delete).
        const decisionsToDeleteSet = new Set<string>();
        const queue: string[] = [decisionId];
        decisionsToDeleteSet.add(decisionId);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            
            prevData.decisions.forEach(potentialChild => {
                if (potentialChild.parentId === currentId) {
                    if (!decisionsToDeleteSet.has(potentialChild.id)) {
                        decisionsToDeleteSet.add(potentialChild.id);
                        queue.push(potentialChild.id);
                    }
                }
            });
        }
        
        const remainingDecisions = prevData.decisions.filter(d => !decisionsToDeleteSet.has(d.id));
        
        const log = createLogEntry({
          userId: actorId,
          action: LogAction.DELETE,
          details: `Deleted Decision: "${decisionToDelete.title}" and ${decisionsToDeleteSet.size - 1} descendant(s).`,
          targetId: decisionId,
          targetType: 'Decision'
        });
        
        return { ...prevData, decisions: remainingDecisions, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  const convertKnowledgeGapToWp = useCallback((kg: KnowledgeGap, decisionId: string, projectId: string, actorId: string) => {
      setData(prevData => {
          const now = new Date().toISOString();
          const newWp: WorkPackage = {
              id: crypto.randomUUID(),
              creatorId: actorId,
              title: kg.title,
              note: `Work package converted from knowledge gap for decision.`,
              type: ItemType.WorkPackage,
              workPackageType: WorkPackageType.Parallel,
              status: ItemStatus.Active,
              flagged: false,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
              parentId: null,
              accountable: kg.assigneeId || actorId,
              responsible: kg.assigneeId ? [kg.assigneeId] : [],
              consulted: [],
              informed: [],
              projectId: projectId,
          };

          const newItems = [...prevData.items, newWp];

          const newDecisions = prevData.decisions.map(decision => {
              if (decision.id === decisionId) {
                  const newKnowledgeGaps = decision.knowledgeGaps.map(g => {
                      if (g.id === kg.id) {
                          return { ...g, convertedToWpId: newWp.id };
                      }
                      return g;
                  });
                  return { ...decision, knowledgeGaps: newKnowledgeGaps };
              }
              return decision;
          });
          
          const log = createLogEntry({
              userId: actorId,
              action: LogAction.CONVERT,
              details: `Converted Knowledge Gap "${kg.title}" to Work Package`,
              targetId: newWp.id,
              targetType: ItemType.WorkPackage
          });

          return { ...prevData, items: newItems, decisions: newDecisions, logs: [log, ...(prevData.logs || [])] };
      });
  }, []);

  const convertDecisionToWp = useCallback((decision: Decision, actorId: string) => {
      setData(prevData => {
          if (decision.convertedToWpId) return prevData;

          const now = new Date().toISOString();
          const newWp: WorkPackage = {
              id: crypto.randomUUID(),
              creatorId: actorId,
              title: decision.title,
              note: `Work package converted from decision: ${decision.title}`,
              type: ItemType.WorkPackage,
              workPackageType: WorkPackageType.Parallel,
              status: ItemStatus.Active,
              flagged: false,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
              parentId: null,
              accountable: actorId,
              responsible: [],
              consulted: [],
              informed: [],
              projectId: decision.projectId,
          };

          const newItems = [...prevData.items, newWp];

          const newDecisions = prevData.decisions.map(d => {
              if (d.id === decision.id) {
                  return { ...d, convertedToWpId: newWp.id };
              }
              return d;
          });
          
          const log = createLogEntry({
              userId: actorId,
              action: LogAction.CONVERT,
              details: `Converted Decision "${decision.title}" to Work Package`,
              targetId: newWp.id,
              targetType: ItemType.WorkPackage
          });

          return { ...prevData, items: newItems, decisions: newDecisions, logs: [log, ...(prevData.logs || [])] };
      });
  }, []);

  const importData = useCallback((type: 'tasks' | 'workPackages' | 'projects' | 'decisions', dataToImport: any[], actorId: string) => {
    setData(prevData => {
        let updatedData = { ...prevData };
        const importCount = dataToImport.length;

        try {
            switch(type) {
                case 'tasks':
                    const existingWPs = prevData.items.filter(i => i.type === ItemType.WorkPackage);
                    const newTasks = dataToImport.map(t => ({...t, type: ItemType.Task}));
                    updatedData.items = [...existingWPs, ...newTasks];
                    break;
                case 'workPackages':
                    const existingTasks = prevData.items.filter(i => i.type === ItemType.Task);
                    const newWPs = dataToImport.map(wp => ({...wp, type: ItemType.WorkPackage}));
                    updatedData.items = [...existingTasks, ...newWPs];
                    break;
                case 'projects':
                    updatedData.projects = dataToImport as Project[];
                    break;
                case 'decisions':
                    updatedData.decisions = dataToImport as Decision[];
                    break;
            }
        } catch (error) {
            console.error("Error processing imported data:", error);
            alert("An error occurred while importing data. The import has been aborted.");
            return prevData;
        }

        const log = createLogEntry({
            userId: actorId,
            action: LogAction.IMPORT,
            details: `Imported ${importCount} records for ${type}.`,
            targetType: 'Data'
        });
        
        return { ...updatedData, logs: [log, ...(prevData.logs || [])] };
    });
  }, []);

  // --- Inbox Feed ---
  const getInboxFeedFilter = useCallback(() => data.inboxFeedFilter, [data.inboxFeedFilter]);

  const setInboxFeedFilter = useCallback((filter: InboxFeedFilter) => {
    setData(prev => ({...prev, inboxFeedFilter: filter}));
  }, []);
  
  const getDismissedFeedItemIds = useCallback(() => data.dismissedFeedItemIds, [data.dismissedFeedItemIds]);
  
  const dismissFeedItem = useCallback((feedItemId: string) => {
    setData(prev => ({...prev, dismissedFeedItemIds: [...new Set([...(prev.dismissedFeedItemIds || []), feedItemId])] }));
  }, []);
  
  const undismissAllFeedItems = useCallback(() => {
    setData(prev => ({ ...prev, dismissedFeedItemIds: [] }));
  }, []);

  return { getItems, getItem, getTags, getPersons, getInbox, getLogs, addLogEntry, upsertItem, deleteItem, addSubTasksToWorkPackage, upsertTag, deleteTag, getDescendants, upsertPerson, deletePerson, saveClarification, getProjects, getDecisions, upsertProject, deleteProject, upsertDecision, deleteDecision, convertKnowledgeGapToWp, convertDecisionToWp, getTodayViewTagIds, setTodayViewTagIds, getTodayViewConfig, setTodayViewConfig, getLeaveBlocks, upsertLeaveBlock, deleteLeaveBlock, getAiConfig, setAiConfig, importData, getRoutines, upsertRoutine, deleteRoutine, getInboxFeedFilter, setInboxFeedFilter, getDismissedFeedItemIds, dismissFeedItem, undismissAllFeedItems, batchCreateItems };
};

export type UseTaskStoreReturn = ReturnType<typeof useTaskStore>;
