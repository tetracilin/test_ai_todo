
import React from 'react';
import { useTasks } from '../context/TaskContext';
import { ItemType, WorkPackage } from '../types';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { CircleIcon } from './icons/CircleIcon';

const TeamView: React.FC<{ onSelectItem: (id: string) => void; }> = ({ onSelectItem }) => {
    const { getItems, getPersons } = useTasks();
    const persons = getPersons();
    const workPackages = getItems().filter(
        (item): item is WorkPackage => item.type === ItemType.WorkPackage && item.title !== 'Inbox'
    );
    
    const getPersonName = (personId: string | null) => {
        if (!personId) return <span className="text-text-secondary dark:text-text-secondary-dark">N/A</span>;
        return persons.find(p => p.id === personId)?.name || 'Unknown';
    };

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th scope="col" className="px-6 py-3">Work Package</th>
                            <th scope="col" className="px-6 py-3 text-center">DoD</th>
                            <th scope="col" className="px-6 py-3">Deadline</th>
                            <th scope="col" className="px-6 py-3">Accountable</th>
                        </tr>
                    </thead>
                    <tbody>
                        {workPackages.length > 0 ? workPackages.map(wp => (
                            <tr 
                                key={wp.id} 
                                className="bg-surface dark:bg-surface-dark border-b dark:border-border-dark hover:bg-gray-50 dark:hover:bg-gray-600/20 cursor-pointer"
                                onClick={() => onSelectItem(wp.id)}
                            >
                                <th scope="row" className="px-6 py-4 font-medium text-text-primary dark:text-text-primary-dark whitespace-nowrap">{wp.title}</th>
                                <td className="px-6 py-4 text-center">
                                    {wp.definitionsOfDone && wp.definitionsOfDone.length > 0 ? (
                                        <CheckCircleIcon className="w-5 h-5 text-green-500 inline-block" />
                                    ) : (
                                        <CircleIcon className="w-5 h-5 text-gray-400 inline-block" />
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    {wp.plannedDeadline ? (
                                        new Date(wp.plannedDeadline).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                                    ) : (
                                        <XCircleIcon className="w-5 h-5 text-red-500" />
                                    )}
                                </td>
                                <td className="px-6 py-4">{getPersonName(wp.accountable)}</td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={4} className="text-center py-10 text-text-secondary dark:text-text-secondary-dark">
                                    No work packages found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TeamView;
