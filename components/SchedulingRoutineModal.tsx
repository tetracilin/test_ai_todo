/**
 * Modal for creating and editing server-side scheduling routines.
 * Persists to the K8 /scheduling-routines API (schedulingApi.createRoutine / updateRoutine).
 * Uses SchedulingRoutineDto / CreateSchedulingRoutineRequest shapes, not the legacy Routine type.
 */

import React, { useState, useEffect } from 'react';
import {
    SchedulingRoutineDto,
    CreateSchedulingRoutineRequest,
    UpdateSchedulingRoutineRequest,
    SchedulingRecurrenceRule,
} from '../services/schedulingApi';
import { fallbackTimezone } from '../services/schedulingUtils';
import { XIcon } from './icons/XIcon';

interface Props {
    /** Existing routine to edit, or null for create. */
    routine: SchedulingRoutineDto | null;
    onClose: () => void;
    onSaveCreate: (data: CreateSchedulingRoutineRequest) => void;
    onSaveUpdate: (id: string, data: UpdateSchedulingRoutineRequest) => void;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const DayButton: React.FC<{ label: string; index: number; selected: Set<number>; onToggle: (i: number) => void }> = ({ label, index, selected, onToggle }) => (
    <button
        type="button"
        onClick={() => onToggle(index)}
        className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${
            selected.has(index) ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text-primary dark:text-text-primary-dark'
        }`}
    >
        {label}
    </button>
);

export const SchedulingRoutineModal: React.FC<Props> = ({ routine, onClose, onSaveCreate, onSaveUpdate }) => {
    const isEdit = routine !== null;
    const tz = fallbackTimezone();

    const [title, setTitle] = useState(routine?.title ?? '');
    const [description, setDescription] = useState(routine?.description ?? '');
    const [priority, setPriority] = useState<'critical' | 'high' | 'medium' | 'low'>(routine?.priority ?? 'medium');
    const [kind, setKind] = useState<'daily' | 'weekly'>(routine?.recurrenceRule.kind ?? 'daily');
    const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(
        () => new Set(routine?.recurrenceRule.kind === 'weekly' ? routine.recurrenceRule.daysOfWeek : [])
    );
    const [timezone, setTimezone] = useState(routine?.timezone ?? tz);
    const [scheduledTime, setScheduledTime] = useState(routine?.scheduledTime ?? '');
    const [estimateMinutes, setEstimateMinutes] = useState<string>(
        routine?.estimateMinutes != null ? String(routine.estimateMinutes) : ''
    );

    useEffect(() => {
        if (!isEdit) return;
        setTitle(routine?.title ?? '');
        setDescription(routine?.description ?? '');
        setPriority(routine?.priority ?? 'medium');
        setKind(routine?.recurrenceRule.kind ?? 'daily');
        setDaysOfWeek(new Set(routine?.recurrenceRule.kind === 'weekly' ? routine!.recurrenceRule.daysOfWeek : []));
    }, [routine, isEdit]);

    const toggleDay = (i: number) => {
        setDaysOfWeek(prev => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            return next;
        });
    };

    const handleSave = () => {
        const trimmed = title.trim();
        if (!trimmed) { alert('Title is required.'); return; }
        const recurrenceRule: SchedulingRecurrenceRule =
            kind === 'weekly'
                ? { kind: 'weekly', daysOfWeek: Array.from(daysOfWeek).sort() }
                : { kind: 'daily' };

        if (isEdit && routine) {
            onSaveUpdate(routine.id, {
                title: trimmed || undefined,
                description: description.trim() || undefined,
                priority: priority === routine.priority ? undefined : priority,
                recurrenceRule,
                timezone: timezone || undefined,
                scheduledTime: scheduledTime || null,
                estimateMinutes: estimateMinutes ? Number(estimateMinutes) : null,
            });
        } else {
            onSaveCreate({
                title: trimmed,
                description: description.trim() || null,
                priority,
                recurrenceRule,
                timezone,
                scheduledTime: scheduledTime || null,
                estimateMinutes: estimateMinutes ? Number(estimateMinutes) : null,
            });
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <style>{`.animate-fade-in-fast { animation: fadeIn 0.15s ease-out forwards; } @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }`}</style>
            <div className="bg-surface dark:bg-surface-dark rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-fade-in-fast">
                <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold">{isEdit ? 'Edit Routine' : 'New Routine'}</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">
                        <XIcon className="w-6 h-6" />
                    </button>
                </header>
                <main className="flex-1 p-6 space-y-6 overflow-y-auto">
                    {/* Title */}
                    <div>
                        <label htmlFor="routine-title" className="text-sm font-medium">Title</label>
                        <input
                            id="routine-title"
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            required
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                        />
                    </div>
                    {/* Description */}
                    <div>
                        <label htmlFor="routine-desc" className="text-sm font-medium">Description (optional)</label>
                        <textarea
                            id="routine-desc"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={2}
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                        />
                    </div>
                    {/* Priority */}
                    <div>
                        <label htmlFor="routine-priority" className="text-sm font-medium">Priority</label>
                        <select
                            id="routine-priority"
                            value={priority}
                            onChange={e => setPriority(e.target.value as typeof priority)}
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                        >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                        </select>
                    </div>
                    {/* Recurrence */}
                    <div>
                        <h3 className="text-lg font-semibold mb-2">Recurrence</h3>
                        <div className="p-4 bg-gray-100/50 dark:bg-gray-800/50 rounded-lg">
                            <div className="flex items-center space-x-4 mb-4">
                                <button
                                    type="button"
                                    onClick={() => setKind('daily')}
                                    className={`px-4 py-2 rounded-md font-semibold ${kind === 'daily' ? 'bg-primary text-white' : 'bg-white dark:bg-gray-700'}`}
                                >Daily</button>
                                <button
                                    type="button"
                                    onClick={() => setKind('weekly')}
                                    className={`px-4 py-2 rounded-md font-semibold ${kind === 'weekly' ? 'bg-primary text-white' : 'bg-white dark:bg-gray-700'}`}
                                >Weekly</button>
                            </div>
                            {kind === 'weekly' && (
                                <div className="flex justify-around">
                                    {WEEKDAY_LABELS.map((day, i) => (
                                        <DayButton key={i} label={day} index={i} selected={daysOfWeek} onToggle={toggleDay} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Time & estimate */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="routine-time" className="text-sm font-medium">Scheduled time (HH:MM 24h, optional)</label>
                            <input
                                id="routine-time"
                                type="text"
                                placeholder="09:00"
                                value={scheduledTime}
                                onChange={e => setScheduledTime(e.target.value)}
                                className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label htmlFor="routine-estimate" className="text-sm font-medium">Estimate (minutes, optional)</label>
                            <input
                                id="routine-estimate"
                                type="number"
                                min={1}
                                placeholder="15"
                                value={estimateMinutes}
                                onChange={e => setEstimateMinutes(e.target.value)}
                                className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                            />
                        </div>
                    </div>
                    {/* Timezone */}
                    <div>
                        <label htmlFor="routine-timezone" className="text-sm font-medium">Timezone</label>
                        <input
                            id="routine-timezone"
                            type="text"
                            placeholder={tz}
                            value={timezone}
                            onChange={e => setTimezone(e.target.value)}
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                        />
                    </div>
                </main>
                <footer className="p-4 border-t border-border-light dark:border-border-dark flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Save Routine</button>
                </footer>
            </div>
        </div>
    );
};