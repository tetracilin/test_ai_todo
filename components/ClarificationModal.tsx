
import React, { useState, useMemo } from 'react';
import { WorkPackage, DefinitionOfDone, Requirement, Person, ItemType } from '../types';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { XIcon } from './icons/XIcon';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';

interface ClarificationModalProps {
    workPackage: WorkPackage;
    onClose: () => void;
}

type ModalDod = DefinitionOfDone & { newSubWpTitle?: string };

export const ClarificationModal: React.FC<ClarificationModalProps> = ({ workPackage, onClose }) => {
    const { getItems, getPersons, saveClarification } = useTasks();
    const { currentUserId } = useAuth();
    const allPersons = getPersons();
    const allItems = getItems();

    const getInitialDods = (): ModalDod[] => {
        return (workPackage.definitionsOfDone || []).map(dod => ({ ...dod, newSubWpTitle: '' }));
    };
    
    const [plannedDeadline, setPlannedDeadline] = useState(workPackage.plannedDeadline?.split('T')[0] || '');
    const [dods, setDods] = useState<ModalDod[]>(getInitialDods);
    const [newRequirementText, setNewRequirementText] = useState<Record<string, string>>({});
    
    const linkedWorkPackages = useMemo(() => {
        const map = new Map<string, string>();
        dods.forEach(dod => {
            if (dod.workPackageId) {
                const wp = allItems.find(item => item.id === dod.workPackageId);
                if (wp) {
                    map.set(dod.workPackageId, wp.title);
                }
            }
        });
        return map;
    }, [dods, allItems]);


    const handleSave = () => {
        const isValid = dods.every(d => d.text.trim() && d.assigneeId);
        if (!isValid) {
            alert('Each "Definition of Done" must have a description and an assigned person.');
            return;
        }
        if (!currentUserId) {
            alert('Cannot save, user not found.');
            return;
        }

        saveClarification(workPackage, plannedDeadline || null, dods, currentUserId);
        onClose();
    };

    const handleAddDod = () => {
        setDods(currentDods => [
            ...currentDods,
            { id: crypto.randomUUID(), text: '', assigneeId: '', requirements: [], workPackageId: null, newSubWpTitle: '' }
        ]);
    };

    const handleDeleteDod = (dodId: string) => {
        setDods(currentDods => currentDods.filter(d => d.id !== dodId));
    };

    const handleDodChange = (dodId: string, field: keyof ModalDod, value: string | null) => {
        setDods(currentDods => currentDods.map(d => 
            d.id === dodId ? { ...d, [field]: value } : d
        ));
    };

    const handleAddRequirement = (dodId: string) => {
        const text = newRequirementText[dodId]?.trim();
        if (!text) return;
        
        setDods(currentDods => currentDods.map(d => {
            if (d.id === dodId) {
                return {
                    ...d,
                    requirements: [...d.requirements, { id: crypto.randomUUID(), text, completed: false }]
                }
            }
            return d;
        }));
        setNewRequirementText(prev => ({ ...prev, [dodId]: '' }));
    };

    const handleRequirementChange = (dodId: string, reqId: string, field: 'text' | 'completed', value: string | boolean) => {
         setDods(currentDods => currentDods.map(d => {
            if (d.id === dodId) {
                return {
                    ...d,
                    requirements: d.requirements.map(r => r.id === reqId ? { ...r, [field]: value } : r)
                }
            }
            return d;
        }));
    };

    const handleDeleteRequirement = (dodId: string, reqId: string) => {
        setDods(currentDods => currentDods.map(d => {
            if (d.id === dodId) {
                return { ...d, requirements: d.requirements.filter(r => r.id !== reqId) };
            }
            return d;
        }));
    };
    
    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in-fast">
            <style>{`
                .animate-fade-in-fast { animation: fadeIn 0.15s ease-out forwards; }
                @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
            `}</style>
            <div className="bg-surface dark:bg-surface-dark rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold text-text-primary dark:text-text-primary-dark">Clarification for: {workPackage.title}</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-700">
                        <XIcon className="w-6 h-6" />
                    </button>
                </header>
                
                <main className="flex-1 p-6 space-y-6 overflow-y-auto">
                    <div>
                        <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Planned Deadline</label>
                        <input
                            type="date"
                            value={plannedDeadline}
                            onChange={(e) => setPlannedDeadline(e.target.value)}
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
                        />
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">Definitions of Done (DoD)</h3>
                        {dods.map((dod, index) => (
                            <div key={dod.id} className="p-4 bg-gray-100/50 dark:bg-gray-800/50 rounded-lg border border-border-light dark:border-border-dark space-y-4">
                                <div className="flex items-center space-x-4">
                                    <span className="font-bold text-primary">#{index + 1}</span>
                                    <input
                                        type="text"
                                        placeholder="Definition of Done (e.g., 'User Authentication Implemented')"
                                        value={dod.text}
                                        onChange={(e) => handleDodChange(dod.id, 'text', e.target.value)}
                                        className="flex-grow p-2 bg-white dark:bg-gray-700 rounded-md border-border-light dark:border-border-dark focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
                                    />
                                    <select
                                        value={dod.assigneeId}
                                        onChange={(e) => handleDodChange(dod.id, 'assigneeId', e.target.value)}
                                        className="p-2 w-48 bg-white dark:bg-gray-700 rounded-md border-border-light dark:border-border-dark focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
                                    >
                                        <option value="" disabled>Assign...</option>
                                        {allPersons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                    <button onClick={() => handleDeleteDod(dod.id)} className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full">
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="pl-8 space-y-3">
                                     <div>
                                        <h4 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-1">Sub-Work Package (Optional)</h4>
                                        {dod.workPackageId ? (
                                            <div className="flex items-center space-x-2">
                                                <span className="px-3 py-1.5 bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 text-sm rounded-md font-medium">
                                                    {linkedWorkPackages.get(dod.workPackageId) || 'Linked Work Package'}
                                                </span>
                                                <button onClick={() => handleDodChange(dod.id, 'workPackageId', null)} className="text-sm text-red-600 hover:underline">Unlink</button>
                                            </div>
                                        ) : (
                                            <input
                                                type="text"
                                                placeholder="Enter title to create a new sub-work package..."
                                                value={dod.newSubWpTitle || ''}
                                                onChange={(e) => handleDodChange(dod.id, 'newSubWpTitle', e.target.value)}
                                                className="w-full p-2 text-sm bg-white dark:bg-gray-700 rounded-md border-border-light dark:border-border-dark focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-1">Task List</h4>
                                        <div className="space-y-2">
                                            {dod.requirements.map(req => (
                                                <div key={req.id} className="group flex items-center space-x-2">
                                                    <input type="checkbox" checked={req.completed} onChange={e => handleRequirementChange(dod.id, req.id, 'completed', e.target.checked)} className="h-4 w-4 rounded text-primary focus:ring-primary border-gray-300 dark:border-gray-600 dark:bg-gray-900"/>
                                                    <input type="text" value={req.text} onChange={e => handleRequirementChange(dod.id, req.id, 'text', e.target.value)} className="flex-grow text-sm p-1 bg-transparent border-none focus:ring-0 focus:bg-white dark:focus:bg-gray-700 rounded" />
                                                    <button onClick={() => handleDeleteRequirement(dod.id, req.id)} className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full opacity-0 group-hover:opacity-100">
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}
                                            <div className="flex items-center space-x-2 pt-1">
                                                <input
                                                    type="text"
                                                    placeholder="Add a new task..."
                                                    value={newRequirementText[dod.id] || ''}
                                                    onChange={(e) => setNewRequirementText(prev => ({...prev, [dod.id]: e.target.value}))}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleAddRequirement(dod.id)}
                                                    className="flex-grow p-1 text-sm bg-white dark:bg-gray-700 rounded-md border-border-light dark:border-border-dark focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
                                                />
                                                <button onClick={() => handleAddRequirement(dod.id)} className="p-1 text-primary hover:bg-primary/10 rounded-full">
                                                    <PlusIcon className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <button onClick={handleAddDod} className="w-full flex items-center justify-center p-2 text-sm text-primary border-2 border-dashed border-primary/50 rounded-lg hover:bg-primary/10">
                            <PlusIcon className="w-5 h-5 mr-2" />
                            Add Definition of Done
                        </button>
                    </div>
                </main>

                <footer className="p-4 border-t border-border-light dark:border-border-dark flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Save and Close</button>
                </footer>
            </div>
        </div>
    );
};