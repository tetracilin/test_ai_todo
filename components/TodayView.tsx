
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { Task, ItemStatus, ItemType, Tag, LeaveBlock, TodayViewConfig } from '../types';
import { PlayIcon } from './icons/PlayIcon';
import { StopIcon } from './icons/StopIcon';
import { AlertTriangleIcon } from './icons/AlertTriangleIcon';
import { BlockTaskModal } from './BlockTaskModal';
import { EditIcon } from './icons/EditIcon';
import { FilterIcon } from './icons/FilterIcon';
import { XIcon } from './icons/XIcon';
import { SettingsIcon } from './icons/SettingsIcon';
import { CoffeeIcon } from './icons/CoffeeIcon';
import { TodayViewSettingsModal } from './TodayViewSettingsModal';
import { AddLeaveModal } from './AddLeaveModal';
import { TrashIcon } from './icons/TrashIcon';

const PIXELS_PER_HOUR = 80;

// --- Helper Functions ---
const isToday = (someDate: Date) => {
    const today = new Date();
    return someDate.getDate() === today.getDate() &&
           someDate.getMonth() === today.getMonth() &&
           someDate.getFullYear() === today.getFullYear();
};

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return [
        hours.toString().padStart(2, '0'),
        minutes.toString().padStart(2, '0'),
        seconds.toString().padStart(2, '0')
    ].join(':');
};

const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

// --- Sub-components ---
const TagFilterPopover: React.FC<{
    allTags: Tag[];
    configuredTagIds: string[];
    onClose: () => void;
    onSave: (selectedIds: string[]) => void;
}> = ({ allTags, configuredTagIds, onClose, onSave }) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(configuredTagIds));

    const handleToggle = (tagId: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(tagId)) {
                newSet.delete(tagId);
            } else {
                newSet.add(tagId);
            }
            return newSet;
        });
    };

    const handleSave = () => {
        onSave(Array.from(selectedIds));
        onClose();
    };

    return (
        <div className="absolute top-14 right-4 z-20 w-64 bg-surface dark:bg-surface-dark rounded-lg shadow-xl border border-border-light dark:border-border-dark flex flex-col">
            <header className="p-3 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                <h3 className="font-semibold text-sm">Filter by Tag</h3>
                <button onClick={onClose} className="p-1 rounded-full text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">
                    <XIcon className="w-4 h-4" />
                </button>
            </header>
            <div className="flex-1 p-3 space-y-2 overflow-y-auto max-h-60">
                {allTags.map(tag => (
                    <label key={tag.id} className="flex items-center space-x-3 cursor-pointer">
                        <input type="checkbox" checked={selectedIds.has(tag.id)} onChange={() => handleToggle(tag.id)} className="h-4 w-4 rounded text-primary focus:ring-primary border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-900" />
                        <span className="text-sm">{tag.name}</span>
                    </label>
                ))}
            </div>
            <footer className="p-3 border-t border-border-light dark:border-border-dark">
                <button onClick={handleSave} className="w-full px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Apply</button>
            </footer>
        </div>
    );
};


// --- Main View ---
export const TodayView: React.FC<{ onSelectItem: (id: string) => void, onToggleSidebar: () => void; }> = ({ onSelectItem, onToggleSidebar }) => {
    const { getItems, upsertItem, getTags, getLeaveBlocks, upsertLeaveBlock, deleteLeaveBlock, getTodayViewConfig, setTodayViewConfig, getTodayViewTagIds, setTodayViewTagIds } = useTasks();
    const { currentUserId } = useAuth();
    
    // State
    const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
    const [blockingTask, setBlockingTask] = useState<Task | null>(null);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
    const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    // Data from store
    const todayConfig = getTodayViewConfig();
    const allTags = getTags();
    const configuredTagIds = getTodayViewTagIds();

    // Memoized data processing
    const { allDayTasks, timedTasks, onGoingTask } = useMemo(() => {
        if (!currentUserId) return { allDayTasks: [], timedTasks: [], onGoingTask: null };

        const allTasks = getItems().filter((i): i is Task => i.type === ItemType.Task);
        const configuredTagIdsSet = new Set(configuredTagIds);
        
        const tasksForToday = allTasks.filter(task => {
            if (task.status === ItemStatus.Completed) return false;
            
            // User must be assignee or collaborator to see it in their Today view
            const isAssignee = task.assigneeId === currentUserId;
            const isCollaborator = (task.collaboratorIds || []).includes(currentUserId);
            if (!isAssignee && !isCollaborator) {
                return false;
            }

            // It must also either be due today OR have a configured tag.
            if (task.dueDate && isToday(new Date(task.dueDate))) return true;
            if (task.tagIds?.some(tagId => configuredTagIdsSet.has(tagId))) return true;

            return false;
        });
        
        const currentOnGoingTask = tasksForToday.find(t => t.status === ItemStatus.OnGoing) || null;
        const timed = tasksForToday.filter(t => t.scheduledTime);
        const allDay = tasksForToday.filter(t => !t.scheduledTime);
        
        return { allDayTasks: allDay, timedTasks: timed, onGoingTask: currentOnGoingTask };
    }, [getItems, configuredTagIds, currentUserId]);
    
    const todayLeaveBlocks = useMemo(() => {
        const todayString = getTodayDateString();
        return getLeaveBlocks().filter(b => b.date === todayString);
    }, [getLeaveBlocks]);

    // Timer effect
    useEffect(() => {
        if (onGoingTask) {
            const timer = setInterval(() => setNow(Date.now()), 1000);
            return () => clearInterval(timer);
        }
    }, [onGoingTask]);
    
    // --- Handlers ---
    const handlePlay = (task: Task) => {
        if (!currentUserId) return;
        if (onGoingTask && onGoingTask.id !== task.id) handleStop(onGoingTask);
        upsertItem({ id: task.id, status: ItemStatus.OnGoing, timerStartedAt: new Date().toISOString() }, currentUserId);
    };

    const handlePlayAllDayTask = (task: Task) => {
        if (!currentUserId) return;
        if (onGoingTask && onGoingTask.id !== task.id) {
            handleStop(onGoingTask);
        }
        
        const now = new Date();
        const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        upsertItem({
            id: task.id,
            status: ItemStatus.OnGoing,
            timerStartedAt: now.toISOString(),
            scheduledTime: timeString,
            estimate: task.estimate || todayConfig.slotDuration, 
        }, currentUserId);
    };

    const handleStop = (task: Task) => {
        if (!currentUserId || !task.timerStartedAt) return;
        const elapsed = (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000;
        upsertItem({ id: task.id, status: ItemStatus.Active, timerStartedAt: null, accumulatedTime: (task.accumulatedTime || 0) + elapsed }, currentUserId);
    };
    
    const handleBlockTask = (task: Task) => {
        setBlockingTask(task);
        setIsBlockModalOpen(true);
    };
    
    const handleAddLeave = useCallback((leaveData: Omit<LeaveBlock, 'id' | 'creatorId'>) => {
        if (!currentUserId) return;
        upsertLeaveBlock({ ...leaveData, id: crypto.randomUUID(), creatorId: currentUserId });
    }, [currentUserId, upsertLeaveBlock]);

    // --- Rendering Helpers ---
    const getDisplayTime = (task: Task) => {
        let totalSeconds = task.accumulatedTime || 0;
        if (task.status === ItemStatus.OnGoing && task.timerStartedAt) {
            totalSeconds += (now - new Date(task.timerStartedAt).getTime()) / 1000;
        }
        return formatTime(totalSeconds);
    };
    
    const timeToY = (time: string) => {
        const minutes = timeToMinutes(time);
        const minutesFromStart = minutes - (todayConfig.startHour * 60);
        return (minutesFromStart / 60) * PIXELS_PER_HOUR;
    };
    
    const timeSlots = useMemo(() => {
        const slots = [];
        for (let hour = todayConfig.startHour; hour <= todayConfig.endHour; hour++) {
            slots.push(hour);
        }
        return slots;
    }, [todayConfig.startHour, todayConfig.endHour]);


    return (
        <div className="flex-1 flex flex-col h-full bg-background dark:bg-background-dark">
             {isSettingsModalOpen && <TodayViewSettingsModal config={todayConfig} onClose={() => setIsSettingsModalOpen(false)} onSave={setTodayViewConfig} />}
             {isLeaveModalOpen && <AddLeaveModal todayConfig={todayConfig} onClose={() => setIsLeaveModalOpen(false)} onAddLeave={handleAddLeave} />}
             {isBlockModalOpen && blockingTask && <BlockTaskModal task={blockingTask} onClose={() => setIsBlockModalOpen(false)} />}
             {isTagFilterOpen && <TagFilterPopover allTags={allTags} configuredTagIds={configuredTagIds} onClose={() => setIsTagFilterOpen(false)} onSave={setTodayViewTagIds}/>}

            <header className="relative p-2 md:p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center flex-shrink-0">
                <button onClick={onToggleSidebar} className="p-1 text-text-secondary hover:text-primary md:hidden"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg></button>
                <h1 className="text-xl font-bold">Today</h1>
                <div className="flex items-center space-x-1">
                    <button onClick={() => setIsTagFilterOpen(true)} className="p-2 rounded-full text-text-secondary hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700" title="Filter by Tag"><FilterIcon className="w-5 h-5"/></button>
                    <button onClick={() => setIsLeaveModalOpen(true)} className="p-2 rounded-full text-text-secondary hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700" title="Add Leave/Away Time"><CoffeeIcon className="w-5 h-5"/></button>
                    <button onClick={() => setIsSettingsModalOpen(true)} className="p-2 rounded-full text-text-secondary hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700" title="Settings"><SettingsIcon className="w-5 h-5"/></button>
                </div>
            </header>

            <div className="flex-1 flex flex-col overflow-hidden">
                {/* All-Day Section */}
                <div className="p-2 md:p-4 border-b border-border-light dark:border-border-dark">
                    <h2 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-2">ALL-DAY</h2>
                    <div className="space-y-2">
                        {allDayTasks.length > 0 ? allDayTasks.map(task => {
                             const isRunning = onGoingTask?.id === task.id;
                             const isBlocked = task.status === ItemStatus.Blocked;
                             const canControlTimer = task.assigneeId === currentUserId;
                             
                             return (
                                 <div key={task.id} className={`p-3 rounded-lg bg-surface dark:bg-surface-dark flex items-center justify-between transition-colors ${isBlocked ? 'opacity-60 bg-red-50 dark:bg-red-900/20' : ''}`}>
                                     <div className="flex-grow truncate pr-4">
                                         <p className="font-medium text-sm text-text-primary dark:text-text-primary-dark">{task.title}</p>
                                         {isBlocked && task.blockageDetails && <p className="text-xs text-red-500 font-semibold truncate">BLOCKED: {task.blockageDetails.details}</p>}
                                     </div>
                                     <div className="flex items-center space-x-2 flex-shrink-0">
                                         <button onClick={() => onSelectItem(task.id)} className="px-4 py-2 text-sm font-bold rounded-md text-text-secondary dark:text-text-secondary-dark bg-gray-200/50 hover:bg-gray-200 dark:bg-gray-700/50 dark:hover:bg-gray-700" title="Details">
                                             Details
                                         </button>
                                         <button onClick={() => handleBlockTask(task)} disabled={isBlocked} className="px-4 py-2 text-sm font-bold rounded-md text-yellow-700 bg-yellow-100 hover:bg-yellow-200 dark:text-yellow-300 dark:bg-yellow-900/50 dark:hover:bg-yellow-900 disabled:opacity-50" title="Block">
                                             Block
                                         </button>
                                         {isRunning ? 
                                             <button onClick={() => handleStop(task)} disabled={!canControlTimer} className="px-4 py-2 text-sm font-bold rounded-md text-white bg-red-500 hover:bg-red-600 disabled:opacity-50" title={canControlTimer ? "Stop" : "Only assignee can stop task"}>
                                                 Stop
                                             </button>
                                             : 
                                             <button onClick={() => handlePlayAllDayTask(task)} disabled={!!onGoingTask || isBlocked || !canControlTimer} className="px-4 py-2 text-sm font-bold rounded-md text-white bg-green-500 hover:bg-green-600 disabled:opacity-50" title={canControlTimer ? "Start" : "Only assignee can start task"}>
                                                 Start
                                             </button>
                                         }
                                     </div>
                                 </div>
                             );
                        }) : <p className="text-sm text-text-secondary dark:text-text-secondary-dark text-center py-1">No all-day tasks for you</p>}
                    </div>
                </div>

                {/* Agenda */}
                <div className="flex-1 flex overflow-y-auto">
                    <div className="w-16 text-right pr-2 pt-2 flex-shrink-0">
                        {timeSlots.map(hour => (
                            <div key={hour} className="text-xs text-text-secondary dark:text-text-secondary-dark" style={{ height: `${PIXELS_PER_HOUR}px` }}>
                               {hour > 12 ? `${hour-12} PM` : (hour === 12 ? '12 PM' : `${hour} AM`)}
                            </div>
                        ))}
                    </div>
                    <div className="flex-grow relative border-l border-border-light dark:border-border-dark">
                        {/* Grid Lines */}
                        {timeSlots.map((hour, index) => index > 0 && (
                             <div key={hour} className="absolute w-full border-t border-border-light dark:border-border-dark" style={{ top: `${index * PIXELS_PER_HOUR}px`, zIndex: 0 }}></div>
                        ))}
                        <div className="absolute w-full border-t border-dashed border-primary" style={{top: timeToY(`${new Date().getHours()}:${new Date().getMinutes()}`)}}></div>

                        {/* Leave Blocks */}
                        {todayLeaveBlocks.map(block => {
                            const top = timeToY(block.startTime);
                            const height = (timeToMinutes(block.endTime) - timeToMinutes(block.startTime)) / 60 * PIXELS_PER_HOUR;
                            return (
                                <div key={block.id} className="absolute w-full pr-2 group" style={{ top: `${top}px`, height: `${height}px`, zIndex: 5 }}>
                                    <div className="h-full rounded-lg bg-gray-200/50 dark:bg-gray-700/50 flex items-center justify-center p-2" style={{backgroundImage: 'repeating-linear-gradient(45deg, hsla(0,0%,100%,.1), hsla(0,0%,100%,.1) 10px, transparent 10px, transparent 20px)'}}>
                                        <p className="font-semibold text-sm text-text-secondary dark:text-text-secondary-dark">{block.title}</p>
                                        <button onClick={() => deleteLeaveBlock(block.id)} className="absolute top-1 right-3 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><TrashIcon className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Timed Tasks */}
                        {timedTasks.map(task => {
                            if(!task.scheduledTime) return null;
                            const top = timeToY(task.scheduledTime);
                            const height = Math.max(30, ((task.estimate || 30) / 60) * PIXELS_PER_HOUR);
                            const isRunning = onGoingTask?.id === task.id;
                            const isBlocked = task.status === ItemStatus.Blocked;
                            const canControlTimer = task.assigneeId === currentUserId;
                            
                            return (
                                <div key={task.id} className="absolute w-full pr-2" style={{ top: `${top}px`, height: `${height}px`, zIndex: 10 }}>
                                    <div className={`group h-full p-2.5 rounded-lg flex flex-col justify-between text-white transition-all duration-200 shadow-lg ${isBlocked ? 'bg-red-400 dark:bg-red-800 border-2 border-red-500' : isRunning ? 'bg-green-500 dark:bg-green-600' : 'bg-primary dark:bg-blue-700'}`}>
                                        <div className="flex-grow cursor-pointer" onClick={(e) => { e.stopPropagation(); onSelectItem(task.id); }}>
                                            <p className="font-bold text-sm truncate">{task.title}</p>
                                            <p className="text-xs opacity-80 truncate">{task.note}</p>
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <p className="font-mono text-sm">{getDisplayTime(task)}</p>
                                            <div className="flex items-center space-x-2">
                                                <button onClick={(e) => { e.stopPropagation(); onSelectItem(task.id) }} className="p-2 rounded-full bg-black/20 hover:bg-black/40" title="Details"><EditIcon className="w-5 h-5"/></button>
                                                <button onClick={(e) => { e.stopPropagation(); handleBlockTask(task); }} disabled={isBlocked} className="p-2 rounded-full bg-black/20 hover:bg-black/40 disabled:opacity-50" title="Block"><AlertTriangleIcon className="w-5 h-5"/></button>
                                                {isRunning ? 
                                                    <button onClick={(e) => { e.stopPropagation(); handleStop(task) }} disabled={!canControlTimer} className="p-2 rounded-full bg-black/20 hover:bg-black/40 disabled:opacity-50" title={canControlTimer ? "Stop" : "Only assignee can stop task"}><StopIcon className="w-5 h-5"/></button>
                                                    : <button onClick={(e) => { e.stopPropagation(); handlePlay(task) }} disabled={!!onGoingTask || isBlocked || !canControlTimer} className="p-2 rounded-full bg-black/20 hover:bg-black/40 disabled:opacity-50" title={canControlTimer ? "Play" : "Only assignee can start task"}><PlayIcon className="w-5 h-5"/></button>
                                                }
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};