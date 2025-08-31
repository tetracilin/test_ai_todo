
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { Task, ItemType, WorkPackage, ItemStatus } from '../types';
import { Calendar } from './Calendar';
import { SettingsIcon } from './icons/SettingsIcon';
import { UserMenu } from './UserMenu';

// --- Constants ---
const PIXELS_PER_HOUR = 60;

// --- Helpers ---
const toISODateString = (date: Date) => date.toISOString().split('T')[0];
const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// --- Draggable Task for the left panel ---
const DraggableTask: React.FC<{ task: Task; canDrag: boolean; }> = ({ task, canDrag }) => {
    const handleDragStart = (e: React.DragEvent, item: Task) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify({ id: item.id, type: 'task' }));
    };
    return (
        <div
            draggable={canDrag}
            onDragStart={canDrag ? (e) => handleDragStart(e, task) : undefined}
            className={`p-3 bg-surface dark:bg-surface-dark rounded-lg shadow-sm border border-border-light dark:border-border-dark ${canDrag ? 'cursor-grab active:cursor-grabbing touch-pan-y' : 'cursor-not-allowed opacity-60'}`}
        >
            <p className="font-medium text-sm text-text-primary dark:text-text-primary-dark">{task.title}</p>
        </div>
    );
}

// --- Agenda Task Item ---
interface AgendaTaskProps {
    task: Task;
    isSelected: boolean;
    canEdit: boolean;
    onClick: (e: React.MouseEvent) => void;
    onToggleComplete: (id: string) => void;
    onDragStart: (e: React.DragEvent) => void;
    onResizeStart: (e: React.MouseEvent | React.TouchEvent) => void;
}
const AgendaTask: React.FC<AgendaTaskProps> = ({ task, isSelected, canEdit, onClick, onToggleComplete, onDragStart, onResizeStart }) => {
    const isCompleted = task.status === ItemStatus.Completed;

    const handleCheckboxClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent onClick of the parent from firing
        onToggleComplete(task.id);
    }
    
    return (
        <div 
            onClick={onClick}
            draggable={!isCompleted && canEdit}
            onDragStart={(!isCompleted && canEdit) ? onDragStart : undefined}
            className={`h-full w-full rounded-lg p-2 flex items-start text-xs transition-all duration-200 relative group touch-pan-y
                ${!canEdit ? 'cursor-default' : 'cursor-pointer'}
                ${isCompleted ? 'bg-green-100 dark:bg-green-900/60' : 'bg-primary/20 dark:bg-primary/30'}
                ${isSelected ? 'ring-2 ring-offset-1 ring-primary dark:ring-offset-surface-dark scale-[1.02] shadow-lg' : ''}
            `}
        >
            <div className="flex-shrink-0 mr-2 mt-0.5" onClick={handleCheckboxClick} role="button" aria-label="Toggle task completion">
                 <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all duration-200 ${
                    isCompleted ? 'bg-primary border-primary' : 'bg-white/50 dark:bg-surface-dark/50 border-gray-400 dark:border-gray-500'
                }`}>
                    {isCompleted && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>}
                </div>
            </div>
            <div className={`flex-grow min-w-0 ${isCompleted ? 'opacity-70' : ''}`}>
                <p className={`font-semibold text-text-primary dark:text-text-primary-dark ${isCompleted ? 'line-through' : ''}`}>
                    {task.title}
                </p>
                {task.note && <p className={`text-text-secondary dark:text-text-secondary-dark truncate ${isCompleted ? 'line-through' : ''}`}>{task.note}</p>}
            </div>

            {!isCompleted && canEdit && (
                 <div
                    onMouseDown={onResizeStart}
                    onTouchStart={onResizeStart}
                    style={{ touchAction: 'none' }}
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white dark:bg-surface-dark border-2 border-primary cursor-ns-resize z-10"
                    aria-label="Resize task duration"
                />
            )}
        </div>
    );
};


// --- Main Schedule View ---
interface ScheduleViewProps {
    onSelectItem: (id: string) => void;
    selectedItemId: string | null;
    onToggleSidebar: () => void;
}
export const ScheduleView: React.FC<ScheduleViewProps> = ({ onSelectItem, selectedItemId, onToggleSidebar }) => {
    const { getItems, getTags, upsertItem, getInbox, getItem } = useTasks();
    const { currentUserId } = useAuth();
    const { getVisibleItemsForUser, canEditItem } = usePermissions();
    const agendaContainerRef = useRef<HTMLDivElement>(null);

    // --- State ---
    const [config, setConfig] = useState({ daysBefore: 2, daysAfter: 15, startHour: 8, endHour: 22, defaultDuration: 15 });
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [projectFilter, setProjectFilter] = useState('all');
    const [tagFilter, setTagFilter] = useState('all');
    const [rangeStartDate, setRangeStartDate] = useState(() => addDays(new Date(), -config.daysBefore));
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    
    // --- Refs for stable handlers ---
    const resizeRef = useRef<{ isResizing: boolean; taskId: string; initialY: number; initialEstimate: number; }>({ isResizing: false, taskId: '', initialY: 0, initialEstimate: 0 });
    const upsertItemRef = useRef(upsertItem);
    const configRef = useRef(config);
    
    useEffect(() => { upsertItemRef.current = upsertItem; }, [upsertItem]);
    useEffect(() => { configRef.current = config; }, [config]);


    // --- Memoized Data ---
    const allItems = getItems();
    const allWorkPackages = useMemo(() => allItems.filter(i => i.type === ItemType.WorkPackage) as WorkPackage[], [allItems]);
    const allTags = getTags();

    const visibleTasks = useMemo(() => {
        if (!currentUserId) return [];
        const userVisibleItems = getVisibleItemsForUser(currentUserId, allItems);
        return userVisibleItems.filter((i): i is Task => i.type === ItemType.Task);
    }, [allItems, currentUserId, getVisibleItemsForUser]);
    
    const unscheduledTasks = useMemo(() => {
        return visibleTasks
            .filter(task => !task.dueDate && task.status === ItemStatus.Active)
            .filter(task => projectFilter === 'all' || task.workPackageId === projectFilter)
            .filter(task => tagFilter === 'all' || task.tagIds.includes(tagFilter));
    }, [visibleTasks, projectFilter, tagFilter]);
    
    const tasksByDate = useMemo(() => {
        const map = new Map<string, Task[]>();
        visibleTasks.forEach(task => {
            if (task.dueDate) {
                const dateKey = toISODateString(new Date(task.dueDate));
                if (!map.has(dateKey)) map.set(dateKey, []);
                map.get(dateKey)!.push(task);
            }
        });
        return map;
    }, [visibleTasks]);

    const { timedTasks, allDayTasks } = useMemo(() => {
        const dateKey = toISODateString(selectedDate);
        const tasks = tasksByDate.get(dateKey) || [];
        const timed: Task[] = [];
        const allDay: Task[] = [];
        
        tasks.forEach(task => {
            if (task.scheduledTime) {
                timed.push(task);
            } else {
                allDay.push(task);
            }
        });
        return { timedTasks: timed, allDayTasks: allDay };
    }, [selectedDate, tasksByDate]);

    const timeSlots = useMemo(() => {
        return Array.from({ length: config.endHour - config.startHour + 1 }, (_, i) => config.startHour + i);
    }, [config.startHour, config.endHour]);

    // --- Handlers ---
    const handleAgendaTaskDragStart = (e: React.DragEvent, task: Task) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify({ id: task.id, type: 'task' }));
    };
    
    const handleResizeMove = useCallback((e: MouseEvent | TouchEvent) => {
        if (!resizeRef.current.isResizing || !currentUserId) return;
        
        const isTouchEvent = 'touches' in e;
        const currentY = isTouchEvent ? e.touches[0].clientY : e.clientY;
        
        const { taskId, initialY, initialEstimate } = resizeRef.current;
        const deltaY = currentY - initialY;
        const minutesPerPixel = 60 / PIXELS_PER_HOUR;
        const deltaMinutes = deltaY * minutesPerPixel;
        
        let newEstimate = Math.round(initialEstimate + deltaMinutes);
        newEstimate = Math.max(15, Math.round(newEstimate / 15) * 15); // Snap to 15 mins, with 15 min minimum
        
        upsertItemRef.current({ id: taskId, estimate: newEstimate }, currentUserId);
    }, [currentUserId]);

    const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent, task: Task) => {
        if (!currentUserId || !canEditItem(task, currentUserId, allItems)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        const isTouchEvent = 'touches' in e;
        const startY = isTouchEvent ? e.touches[0].clientY : e.clientY;
        
        resizeRef.current = {
            isResizing: true,
            taskId: task.id,
            initialY: startY,
            initialEstimate: task.estimate || configRef.current.defaultDuration,
        };
        
        const onMouseMove = handleResizeMove;

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('touchmove', onMouseMove);
            window.removeEventListener('touchend', onMouseUp);

            if (resizeRef.current.isResizing) {
                resizeRef.current.isResizing = false;
                
                const preventClick = (e: MouseEvent) => {
                    e.stopPropagation();
                    window.removeEventListener('click', preventClick, true);
                };
                window.addEventListener('click', preventClick, true);
            }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('touchmove', onMouseMove, { passive: false });
        window.addEventListener('touchend', onMouseUp);
    }, [handleResizeMove, currentUserId, canEditItem, allItems]);
    
    const handleDropOnDate = (date: Date, taskId: string) => {
        if (!currentUserId) return;
        const task = getItem(taskId);
        if (task && !canEditItem(task, currentUserId, allItems)) {
            alert("You don't have permission to schedule this task.");
            return;
        }
        upsertItem({ id: taskId, dueDate: date.toISOString(), scheduledTime: null }, currentUserId);
    };

    const handleDropOnAgenda = (e: React.DragEvent) => {
        e.preventDefault();
        if (!currentUserId) return;
        const rect = agendaContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const taskData = e.dataTransfer.getData('application/json');
        if (!taskData) return;
        
        const offsetY = e.clientY - rect.top;
        const minutesFromStart = Math.max(0, (offsetY / PIXELS_PER_HOUR) * 60);
        const hour = Math.floor(minutesFromStart / 60) + config.startHour;
        const minute = Math.floor(minutesFromStart % 60);
        const roundedMinute = Math.round(minute / 15) * 15;
        
        const finalHour = Math.floor(hour + roundedMinute / 60);
        const finalMinute = roundedMinute % 60;

        const timeString = `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;
        
        const parsed = JSON.parse(taskData);
        if(parsed.id) {
            const task = getItem(parsed.id);
            if (task && !canEditItem(task, currentUserId, allItems)) {
                alert("You don't have permission to schedule this task.");
                return;
            }
            upsertItem({ id: parsed.id, dueDate: selectedDate.toISOString(), scheduledTime: timeString, estimate: (getItem(parsed.id) as Task)?.estimate || config.defaultDuration }, currentUserId);
        }
    };
    
    const handleAgendaClick = (e: React.MouseEvent) => {
        if (e.target !== e.currentTarget || !currentUserId) return;

        const rect = agendaContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const offsetY = e.clientY - rect.top;
        const minutesFromStart = Math.max(0, (offsetY / PIXELS_PER_HOUR) * 60);
        const hour = Math.floor(minutesFromStart / 60) + config.startHour;
        const minute = Math.floor(minutesFromStart % 60);
        const roundedMinute = Math.floor(minute / 15) * 15;
        
        const finalHour = Math.floor(hour + roundedMinute / 60);
        const finalMinute = roundedMinute % 60;
        
        const timeString = `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;

        const newTask: Omit<Task, 'createdAt' | 'updatedAt'> = {
            id: crypto.randomUUID(),
            creatorId: currentUserId,
            title: 'New Event',
            note: '',
            type: ItemType.Task,
            workPackageId: getInbox()?.id || null,
            parentId: null,
            tagIds: [],
            dueDate: selectedDate.toISOString(),
            deferDate: null,
            scheduledTime: timeString,
            estimate: config.defaultDuration,
            completedAt: null,
            status: ItemStatus.Active,
            flagged: false,
            isBlocked: false,
            blockageDetails: null,
            timerStartedAt: null,
            accumulatedTime: 0,
            assigneeId: currentUserId,
            collaboratorIds: [],
            clarificationNotes: '',
        };
        upsertItem(newTask, currentUserId);
        onSelectItem(newTask.id);
    };
    
    const handleToggleComplete = (taskId: string) => {
        if (!currentUserId) return;
        const task = getItem(taskId);
        if (!task) return;
        if (!canEditItem(task, currentUserId, allItems)) {
            alert("You don't have permission to modify this task.");
            return;
        }
        const isCompleted = task.status === ItemStatus.Completed;
        upsertItem({
            id: taskId,
            status: isCompleted ? ItemStatus.Active : ItemStatus.Completed,
            completedAt: isCompleted ? null : new Date().toISOString()
        }, currentUserId);
    };

    const handleNavigate = (direction: 'prev' | 'next') => {
        const dayCount = config.daysBefore + config.daysAfter + 1;
        const newStartDate = addDays(rangeStartDate, direction === 'prev' ? -dayCount : dayCount);
        setRangeStartDate(newStartDate);
    };

    const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        const numValue = parseInt(value, 10);
        if (isNaN(numValue)) return;
        
        setConfig(prev => {
            const newConfig = { ...prev, [name]: numValue };
            if (name === 'daysBefore') {
                 setRangeStartDate(addDays(new Date(), -numValue));
                 setSelectedDate(new Date());
            }
            return newConfig;
        });
    };
    
    return (
        <div className="flex flex-1 flex-col h-full bg-background dark:bg-background-dark text-text-primary dark:text-text-primary-dark min-w-0">
             <header className="p-2 md:p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center relative flex-shrink-0">
                <button onClick={onToggleSidebar} className="p-1 text-text-secondary dark:text-text-secondary-dark hover:text-primary md:hidden">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>
                <h1 className="text-xl font-bold absolute left-1/2 -translate-x-1/2 md:static md:left-auto md:translate-x-0">Schedule</h1>
                <div className="flex items-center space-x-2">
                    <div className="w-48 hidden md:block">
                      <UserMenu />
                    </div>
                    <button onClick={() => setIsConfigOpen(!isConfigOpen)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                        <SettingsIcon className="w-5 h-5"/>
                    </button>
                </div>
            </header>

            {isConfigOpen && (
                <div className="p-4 border-b border-border-light dark:border-border-dark bg-surface dark:bg-surface-dark grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
                    <div className="col-span-2 md:col-span-2">
                        <h3 className="font-semibold text-text-primary dark:text-text-primary-dark mb-2">Agenda Display</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm text-text-secondary dark:text-text-secondary-dark">Days Before</label>
                                <input type="number" name="daysBefore" value={config.daysBefore} onChange={handleConfigChange} className="w-full p-2 mt-1 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                            </div>
                            <div>
                                <label className="text-sm text-text-secondary dark:text-text-secondary-dark">Days After</label>
                                <input type="number" name="daysAfter" value={config.daysAfter} onChange={handleConfigChange} className="w-full p-2 mt-1 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                            </div>
                            <div>
                                <label className="text-sm text-text-secondary dark:text-text-secondary-dark">Start Hour</label>
                                <input type="number" name="startHour" min="0" max="23" value={config.startHour} onChange={handleConfigChange} className="w-full p-2 mt-1 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                            </div>
                            <div>
                                <label className="text-sm text-text-secondary dark:text-text-secondary-dark">End Hour</label>
                                <input type="number" name="endHour" min="1" max="24" value={config.endHour} onChange={handleConfigChange} className="w-full p-2 mt-1 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                            </div>
                        </div>
                    </div>
                     <div className="col-span-2 md:col-span-1">
                        <h3 className="font-semibold text-text-primary dark:text-text-primary-dark mb-2">Task Defaults</h3>
                         <div>
                            <label className="text-sm text-text-secondary dark:text-text-secondary-dark">Duration (min)</label>
                            <input type="number" name="defaultDuration" min="5" value={config.defaultDuration} onChange={handleConfigChange} className="w-full p-2 mt-1 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                <aside className="w-full md:w-1/3 md:border-r border-b md:border-b-0 border-border-light dark:border-border-dark flex flex-col p-4 space-y-4 max-h-60 md:max-h-full">
                    <h2 className="text-lg font-semibold">Unscheduled Tasks</h2>
                    <div className="flex gap-2">
                        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="flex-1 p-2 bg-surface dark:bg-surface-dark rounded-md border border-border-light dark:border-border-dark focus:ring-primary focus:border-primary">
                            <option value="all">All Work Packages</option>
                            {allWorkPackages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select>
                        <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="flex-1 p-2 bg-surface dark:bg-surface-dark rounded-md border border-border-light dark:border-border-dark focus:ring-primary focus:border-primary">
                            <option value="all">All Tags</option>
                            {allTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                        {unscheduledTasks.length > 0 ? (
                            unscheduledTasks.map(task => {
                                const canDrag = currentUserId ? canEditItem(task, currentUserId, allItems) : false;
                                return <DraggableTask key={task.id} task={task} canDrag={canDrag} />
                            })
                        ) : (
                            <div className="text-center py-10 text-text-secondary dark:text-text-secondary-dark">No unscheduled tasks.</div>
                        )}
                    </div>
                </aside>
                
                <main className="w-full md:w-2/3 flex flex-col">
                    <Calendar
                        rangeStartDate={rangeStartDate}
                        dayCount={config.daysBefore + config.daysAfter + 1}
                        selectedDate={selectedDate}
                        tasksByDate={tasksByDate}
                        onNavigate={handleNavigate}
                        onDateSelect={(d) => setSelectedDate(d)}
                        onDropOnDate={handleDropOnDate}
                    />
                    <div className="flex-1 overflow-y-auto p-4 pl-14 md:pl-16">
                        <h2 className="text-lg font-semibold mb-4 -ml-12 md:-ml-12">
                            Agenda for {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                        </h2>
                        
                        {allDayTasks.length > 0 && (
                            <div className="mb-4 -ml-12 md:-ml-12">
                               <h3 className="font-semibold text-sm mb-2 text-text-secondary dark:text-text-secondary-dark">All-day</h3>
                               <div className="p-2 border border-dashed border-border-light dark:border-border-dark rounded-lg space-y-2">
                                    {allDayTasks.map(task => {
                                        const canEdit = currentUserId ? canEditItem(task, currentUserId, allItems) : false;
                                        return (
                                            <AgendaTask 
                                                key={task.id} 
                                                task={task} 
                                                isSelected={task.id === selectedItemId}
                                                canEdit={canEdit}
                                                onClick={() => onSelectItem(task.id)}
                                                onToggleComplete={handleToggleComplete}
                                                onDragStart={(e) => handleAgendaTaskDragStart(e, task)}
                                                onResizeStart={() => {}}
                                            />
                                        );
                                    })}
                               </div>
                            </div>
                        )}
                        
                        <div 
                            ref={agendaContainerRef}
                            className="relative"
                            style={{ height: `${(config.endHour - config.startHour) * PIXELS_PER_HOUR}px` }}
                            onClick={handleAgendaClick}
                            onDrop={handleDropOnAgenda}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            {/* Background Grid Lines */}
                            {timeSlots.map(hour => (
                                <div key={hour} className="absolute w-full border-t border-border-light dark:border-border-dark" style={{ top: `${(hour - config.startHour) * PIXELS_PER_HOUR}px`, left: 0 }}>
                                    <span className="absolute -top-3 -left-11 text-xs md:text-sm text-text-secondary dark:text-text-secondary-dark w-10 text-right">
                                        {hour > 12 ? `${hour-12} PM` : (hour === 12 ? '12 PM' : (hour === 0 ? '12 AM' : `${hour} AM`))}
                                    </span>
                                </div>
                            ))}

                            {/* Timed Tasks */}
                            {timedTasks.map(task => {
                                if (!task.scheduledTime) return null;
                                const [h, m] = task.scheduledTime.split(':').map(Number);
                                const top = ((h - config.startHour) + (m / 60)) * PIXELS_PER_HOUR;
                                const duration = task.estimate || config.defaultDuration;
                                const height = Math.max(15, (duration / 60) * PIXELS_PER_HOUR - 2);
                                const isSelected = task.id === selectedItemId;
                                const canEdit = currentUserId ? canEditItem(task, currentUserId, allItems) : false;

                                return (
                                    <div 
                                        key={task.id}
                                        className="absolute w-full pr-1"
                                        style={{ top: `${top}px`, height: `${height}px`, left: '0.25rem', zIndex: isSelected ? 10 : 1 }}
                                    >
                                        <AgendaTask 
                                            task={task}
                                            isSelected={isSelected}
                                            canEdit={canEdit}
                                            onClick={(e) => { e.stopPropagation(); onSelectItem(task.id); }}
                                            onToggleComplete={handleToggleComplete}
                                            onDragStart={(e) => handleAgendaTaskDragStart(e, task)}
                                            onResizeStart={(e) => handleResizeStart(e, task)}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                         {(allDayTasks.length === 0 && timedTasks.length === 0) && (
                            <div className="text-center py-10 text-text-secondary dark:text-text-secondary-dark -ml-12">No tasks scheduled for this day. Click timeline to add.</div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
};