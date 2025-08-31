
import React, { useState, useEffect } from 'react';
import { Routine, RecurrenceRule, RecurrenceFrequency, Person, Tag } from '../types';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { XIcon } from './icons/XIcon';

interface RoutineModalProps {
    routine: Partial<Routine> | null;
    onClose: () => void;
    onSave: (routine: Partial<Routine> & { id: string }) => void;
}

const DayButton: React.FC<{ day: string, index: number, selectedDays: Set<number>, onToggle: (dayIndex: number) => void }> = ({ day, index, selectedDays, onToggle }) => (
    <button
        type="button"
        onClick={() => onToggle(index)}
        className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors ${selectedDays.has(index) ? 'bg-primary text-white' : 'bg-gray-200 text-text-primary dark:bg-gray-700 dark:text-text-primary-dark hover:bg-gray-300 dark:hover:bg-gray-600'}`}
    >
        {day}
    </button>
);

export const RoutineModal: React.FC<RoutineModalProps> = ({ routine, onClose, onSave }) => {
    const { getPersons, getTags } = useTasks();
    const { currentUserId } = useAuth();
    
    const [formData, setFormData] = useState<Partial<Routine>>({});
    const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
    
    const allPersons = getPersons();
    const allTags = getTags();

    useEffect(() => {
        if (routine) {
            setFormData(routine);
            const initialDays = routine.recurrenceRule?.frequency === RecurrenceFrequency.Weekly ? routine.recurrenceRule.daysOfWeek || [] : [];
            setSelectedDays(new Set(initialDays));
        }
    }, [routine]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value === '' ? null : parseInt(e.target.value, 10);
        setFormData({ ...formData, [e.target.name]: value });
    };

    const handleFrequencyChange = (frequency: RecurrenceFrequency) => {
        setFormData(prev => ({
            ...prev,
            recurrenceRule: {
                ...prev.recurrenceRule,
                frequency,
                daysOfWeek: frequency === RecurrenceFrequency.Daily ? [] : prev.recurrenceRule?.daysOfWeek || [],
            } as RecurrenceRule
        }));
        if (frequency === RecurrenceFrequency.Daily) {
            setSelectedDays(new Set());
        }
    };
    
    const handleDayToggle = (dayIndex: number) => {
        setSelectedDays(prev => {
            const newSet = new Set(prev);
            if (newSet.has(dayIndex)) {
                newSet.delete(dayIndex);
            } else {
                newSet.add(dayIndex);
            }
            return newSet;
        });
    };

    const handleSaveClick = () => {
        if (!formData.title?.trim()) {
            alert('Title is required.');
            return;
        }
        if (!currentUserId) {
            alert('Cannot save, no user logged in.');
            return;
        }

        const finalRecurrenceRule: RecurrenceRule = {
            frequency: formData.recurrenceRule?.frequency || RecurrenceFrequency.Daily,
            daysOfWeek: Array.from(selectedDays).sort(),
        };

        if (finalRecurrenceRule.frequency === RecurrenceFrequency.Weekly && finalRecurrenceRule.daysOfWeek?.length === 0) {
            alert('Please select at least one day for weekly recurrence.');
            return;
        }

        const routineToSave: Partial<Routine> & { id: string } = {
            id: formData.id || crypto.randomUUID(),
            creatorId: formData.creatorId || currentUserId,
            title: formData.title,
            note: formData.note || '',
            tagIds: formData.tagIds || [],
            estimate: formData.estimate || null,
            assigneeId: formData.assigneeId || null,
            recurrenceRule: finalRecurrenceRule,
        };

        onSave(routineToSave);
    };

    if (!routine) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in-fast">
             <style>{`.animate-fade-in-fast { animation: fadeIn 0.15s ease-out forwards; } @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }`}</style>
            <div className="bg-surface dark:bg-surface-dark rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold">{routine.id ? 'Edit Routine' : 'Create Routine'}</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">
                        <XIcon className="w-6 h-6" />
                    </button>
                </header>
                <main className="flex-1 p-6 space-y-6 overflow-y-auto">
                    <div>
                        <label htmlFor="title" className="text-sm font-medium">Title</label>
                        <input type="text" name="title" id="title" value={formData.title || ''} onChange={handleInputChange} required className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                    </div>
                    <div>
                        <label htmlFor="note" className="text-sm font-medium">Note</label>
                        <textarea name="note" id="note" value={formData.note || ''} onChange={handleInputChange} rows={3} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                             <label htmlFor="assigneeId" className="text-sm font-medium">Assign To</label>
                            <select name="assigneeId" id="assigneeId" value={formData.assigneeId || ''} onChange={handleInputChange} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary">
                                <option value="">Unassigned</option>
                                {allPersons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="estimate" className="text-sm font-medium">Estimate (minutes)</label>
                            <input type="number" name="estimate" id="estimate" value={formData.estimate || ''} onChange={handleNumberChange} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold mb-2">Recurrence Rule</h3>
                        <div className="p-4 bg-gray-100/50 dark:bg-gray-800/50 rounded-lg">
                            <div className="flex items-center space-x-4 mb-4">
                               <button type="button" onClick={() => handleFrequencyChange(RecurrenceFrequency.Daily)} className={`px-4 py-2 rounded-md font-semibold ${formData.recurrenceRule?.frequency === RecurrenceFrequency.Daily ? 'bg-primary text-white' : 'bg-white dark:bg-gray-700'}`}>Daily</button>
                               <button type="button" onClick={() => handleFrequencyChange(RecurrenceFrequency.Weekly)} className={`px-4 py-2 rounded-md font-semibold ${formData.recurrenceRule?.frequency === RecurrenceFrequency.Weekly ? 'bg-primary text-white' : 'bg-white dark:bg-gray-700'}`}>Weekly</button>
                            </div>
                            {formData.recurrenceRule?.frequency === RecurrenceFrequency.Weekly && (
                                <div className="flex justify-around">
                                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                                        <DayButton key={i} day={day} index={i} selectedDays={selectedDays} onToggle={handleDayToggle} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </main>
                <footer className="p-4 border-t border-border-light dark:border-border-dark flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSaveClick} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Save Routine</button>
                </footer>
            </div>
        </div>
    );
};
