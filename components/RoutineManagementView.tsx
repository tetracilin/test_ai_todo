
import React, { useState } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { Routine, RecurrenceFrequency } from '../types';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { EditIcon } from './icons/EditIcon';
import { RoutineModal } from './RoutineModal';

const formatRecurrenceRule = (rule: Routine['recurrenceRule']): string => {
    if (rule.frequency === RecurrenceFrequency.Daily) {
        return 'Daily';
    }
    if (rule.frequency === RecurrenceFrequency.Weekly) {
        if (!rule.daysOfWeek || rule.daysOfWeek.length === 0) return 'Weekly (No days selected)';
        if (rule.daysOfWeek.length === 7) return 'Every Day';
        
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return rule.daysOfWeek.sort().map(d => dayNames[d]).join(', ');
    }
    return 'Unknown';
};

export const RoutineManagementView: React.FC = () => {
    const { getRoutines, upsertRoutine, deleteRoutine, getPersons } = useTasks();
    const { currentUserId } = useAuth();
    const routines = getRoutines();
    const persons = getPersons();
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRoutine, setEditingRoutine] = useState<Partial<Routine> | null>(null);

    const handleOpenModal = (routine?: Routine) => {
        const newRoutineTemplate: Partial<Routine> = {
            title: '',
            note: '',
            assigneeId: currentUserId,
            estimate: 15,
            tagIds: [],
            recurrenceRule: {
                frequency: RecurrenceFrequency.Daily,
                daysOfWeek: []
            }
        };
        setEditingRoutine(routine || newRoutineTemplate);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setEditingRoutine(null);
        setIsModalOpen(false);
    };

    const handleSave = (routine: Partial<Routine> & { id: string }) => {
        if (!currentUserId) return;
        upsertRoutine(routine, currentUserId);
        handleCloseModal();
    };

    const handleDelete = (routineId: string) => {
        if (!currentUserId) return;
        if (window.confirm("Are you sure you want to delete this routine?")) {
            deleteRoutine(routineId, currentUserId);
        }
    };

    const getPersonName = (personId: string | null) => {
        if (!personId) return <span className="text-text-secondary dark:text-text-secondary-dark">Unassigned</span>;
        return persons.find(p => p.id === personId)?.name || 'Unknown';
    };

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            {isModalOpen && editingRoutine && (
                <RoutineModal routine={editingRoutine} onClose={handleCloseModal} onSave={handleSave} />
            )}
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold">Manage Routines</h2>
                <button onClick={() => handleOpenModal()} className="flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">
                    <PlusIcon className="w-5 h-5 mr-2 -ml-1" /> New Routine
                </button>
            </div>
            
            <div className="bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th scope="col" className="px-6 py-3">Title</th>
                                <th scope="col" className="px-6 py-3">Assignee</th>
                                <th scope="col" className="px-6 py-3">Recurs</th>
                                <th scope="col" className="px-6 py-3"><span className="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {routines.length > 0 ? routines.map(r => (
                                <tr key={r.id} className="border-b dark:border-border-dark hover:bg-gray-50 dark:hover:bg-gray-600/20">
                                    <td scope="row" className="px-6 py-4 font-medium whitespace-nowrap">{r.title}</td>
                                    <td className="px-6 py-4">{getPersonName(r.assigneeId)}</td>
                                    <td className="px-6 py-4">{formatRecurrenceRule(r.recurrenceRule)}</td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end space-x-2">
                                            <button onClick={() => handleOpenModal(r)} className="p-2 text-text-secondary hover:text-primary rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"><EditIcon className="w-5 h-5"/></button>
                                            <button onClick={() => handleDelete(r.id)} className="p-2 text-text-secondary hover:text-red-500 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"><TrashIcon className="w-5 h-5"/></button>
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={4} className="text-center py-10 text-text-secondary dark:text-text-secondary-dark">
                                        No routines found. Create one to get started.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
