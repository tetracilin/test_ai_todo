

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Decision, KnowledgeGap, Project, WorkPackage, Person, DecisionStatus } from '../types';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { XIcon } from './icons/XIcon';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import { TrashIcon } from './icons/TrashIcon';
import { PlusIcon } from './icons/PlusIcon';
import { WorkPackageIcon } from './icons/ProjectIcon';

const DateInput: React.FC<{ label: string; value: string | null; onChange: (value: string | null) => void }> = ({ label, value, onChange }) => (
    <div>
        <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">{label}</label>
        <input
            type="date"
            value={value ? value.split('T')[0] : ''}
            onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
        />
    </div>
);

export const DecisionDetail: React.FC<{
    itemId: string;
    onClose: () => void;
    onDelete: (id: string) => void;
    setActiveView: (view: string) => void;
}> = ({ itemId, onClose, onDelete, setActiveView }) => {
    const { getDecisions, getProjects, upsertDecision, convertKnowledgeGapToWp, getItems, getPersons } = useTasks();
    const { currentUserId } = useAuth();
    const parentSelectorRef = useRef<HTMLDivElement>(null);

    const allDecisions = getDecisions();
    const allProjects = getProjects();
    const allPersons = getPersons();
    const workPackages = getItems().filter(i => i.type === 'WorkPackage') as WorkPackage[];
    
    const [decision, setDecision] = useState<Decision | null>(null);
    const [newKgText, setNewKgText] = useState('');
    const [newKgAssignee, setNewKgAssignee] = useState<string>(currentUserId || (allPersons.length > 0 ? allPersons[0].id : ''));
    const [parentSearch, setParentSearch] = useState('');
    const [isParentDropdownOpen, setIsParentDropdownOpen] = useState(false);

    useEffect(() => {
        const foundDecision = allDecisions.find(d => d.id === itemId);
        setDecision(foundDecision || null);
        setNewKgText('');
    }, [itemId, allDecisions]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (parentSelectorRef.current && !parentSelectorRef.current.contains(event.target as Node)) {
                setIsParentDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleUpdate = (updates: Partial<Decision>) => {
        if (decision && currentUserId) {
            const updatedDecision = { ...decision, ...updates };
            // Don't set state directly, let upsert and useEffect handle it to prevent stale state issues with validation
            upsertDecision(updatedDecision as Decision, currentUserId);
        }
    };
    
    const handleAddKnowledgeGap = () => {
        if (!newKgText.trim() || !decision) return;
        if (!newKgAssignee) {
            alert("Please assign the knowledge gap to a person.");
            return;
        }
        const newKg: KnowledgeGap = {
            id: crypto.randomUUID(),
            title: newKgText,
            assigneeId: newKgAssignee,
            decisionId: decision.id,
            convertedToWpId: null
        };
        handleUpdate({ knowledgeGaps: [...(decision.knowledgeGaps || []), newKg] });
        setNewKgText('');
    };

    const handleDeleteKnowledgeGap = (kgId: string) => {
        if (!decision) return;
        handleUpdate({ knowledgeGaps: (decision.knowledgeGaps || []).filter(kg => kg.id !== kgId) });
    };
    
    const handleConvertKg = (kg: KnowledgeGap) => {
        if (!currentUserId || !decision?.id || !decision.projectId) return;
        convertKnowledgeGapToWp(kg, decision.id, decision.projectId, currentUserId);
    };

    const handleViewWp = (wpId: string) => {
        onClose(); // Close the detail panel before navigating
        setActiveView(`workPackage/${wpId}`);
    };
    
    // --- Parent Decision Logic ---
    const parentCandidateDecisions = useMemo(() => {
        // You can't be your own parent
        return allDecisions.filter(d => d.id !== decision?.id);
    }, [allDecisions, decision]);

    const selectedParent = useMemo(() => {
        if (!decision?.parentId) return null;
        return allDecisions.find(d => d.id === decision.parentId);
    }, [decision?.parentId, allDecisions]);

    const filteredParentCandidates = useMemo(() => {
        if (!parentSearch) return parentCandidateDecisions;
        return parentCandidateDecisions.filter(d =>
            d.title.toLowerCase().includes(parentSearch.toLowerCase())
        );
    }, [parentSearch, parentCandidateDecisions]);

    const handleSelectParent = (parentId: string | null) => {
        handleUpdate({ parentId });
        setParentSearch('');
        setIsParentDropdownOpen(false);
    };
    
    const handleCreateAndSelectParent = () => {
        if (!parentSearch.trim() || !decision?.projectId || !currentUserId) {
            alert("To create a parent, it needs a title and the current decision must be assigned to a project.");
            return;
        };

        const newDecisionData: Partial<Decision> & { id: string } = {
            id: crypto.randomUUID(),
            title: parentSearch.trim(),
            projectId: decision.projectId,
            parentId: null,
            knowledgeGaps: [],
            convertedToWpId: null,
            status: DecisionStatus.ToDo,
        };
        
        upsertDecision(newDecisionData, currentUserId);
        handleSelectParent(newDecisionData.id);
    };


    if (!decision) {
        return (
            <div className="w-full h-full bg-surface dark:bg-surface-dark flex items-center justify-center border-l border-border-light dark:border-border-dark">
                <p className="text-text-secondary dark:text-text-secondary-dark">Select a decision to see details</p>
            </div>
        );
    }
    
    return (
        <div className="w-full h-full bg-surface dark:bg-surface-dark flex flex-col animate-slide-in overflow-y-auto border-l border-border-light dark:border-border-dark touch-pan-y">
            <div className="flex-grow p-4 md:p-6 space-y-6">
                <div className="flex items-start justify-between">
                    <button onClick={onClose} className="p-2 -ml-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors md:hidden">
                        <ChevronLeftIcon className="w-6 h-6" />
                    </button>
                    <input
                        type="text"
                        value={decision.title}
                        onChange={(e) => handleUpdate({ title: e.target.value })}
                        className="text-2xl font-bold bg-transparent border-none w-full focus:ring-0 p-0 mx-2 text-text-primary dark:text-text-primary-dark"
                    />
                    <button onClick={onClose} className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors hidden md:block">
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Project</label>
                        <select value={decision.projectId || ''} onChange={e => handleUpdate({ projectId: e.target.value })} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark">
                            <option value="">Select Project</option>
                            {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Parent Decision</label>
                         <div className="relative mt-1" ref={parentSelectorRef}>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={isParentDropdownOpen ? parentSearch : (selectedParent?.title || '')}
                                    onChange={(e) => { setParentSearch(e.target.value); if(!isParentDropdownOpen) setIsParentDropdownOpen(true); }}
                                    onFocus={() => { setParentSearch(''); setIsParentDropdownOpen(true); }}
                                    placeholder="Search or create parent..."
                                    className="w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
                                />
                                {selectedParent && (
                                    <button onClick={() => handleSelectParent(null)} className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 hover:text-gray-600">
                                        <XIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                            {isParentDropdownOpen && (
                                <div className="absolute z-10 w-full mt-1 bg-surface dark:bg-surface-dark rounded-md shadow-lg border border-border-light dark:border-border-dark max-h-60 overflow-y-auto">
                                    <ul>
                                        {parentSearch && (
                                            <li>
                                                <button onClick={handleCreateAndSelectParent} className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center">
                                                    <PlusIcon className="w-4 h-4 mr-2" />
                                                    Create decision: "{parentSearch}"
                                                </button>
                                            </li>
                                        )}
                                        {filteredParentCandidates.map(d => (
                                            <li key={d.id}>
                                                <button onClick={() => handleSelectParent(d.id)} className="w-full text-left px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark hover:bg-gray-100 dark:hover:bg-gray-700">
                                                    {d.title}
                                                </button>
                                            </li>
                                        ))}
                                        {parentSearch && filteredParentCandidates.length === 0 && (
                                            <li className="px-3 py-2 text-sm text-text-secondary dark:text-text-secondary-dark text-center">
                                                No matches found.
                                            </li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                 <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">Planning</h3>
                    <div className="p-4 bg-gray-100/50 dark:bg-gray-800/50 rounded-lg border border-border-light dark:border-border-dark space-y-4">
                        <div>
                            <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Status</label>
                            <select
                                value={decision.status}
                                onChange={e => handleUpdate({ status: e.target.value as DecisionStatus })}
                                className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary text-text-primary dark:text-text-primary-dark"
                            >
                                {Object.values(DecisionStatus).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <DateInput label="Planned Start" value={decision.plannedStartDate} onChange={val => handleUpdate({ plannedStartDate: val })} />
                            <DateInput label="Planned Finish" value={decision.plannedFinishDate} onChange={val => handleUpdate({ plannedFinishDate: val })} />
                            <DateInput label="Actual Start" value={decision.actualStartDate} onChange={val => handleUpdate({ actualStartDate: val })} />
                            <DateInput label="Actual Finish" value={decision.actualFinishDate} onChange={val => handleUpdate({ actualFinishDate: val })} />
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">Knowledge Gaps</h3>
                    <div className="space-y-2">
                        {(decision.knowledgeGaps || []).length > 0 ? (
                            decision.knowledgeGaps.map(kg => {
                                const wp = kg.convertedToWpId ? workPackages.find(w => w.id === kg.convertedToWpId) : null;
                                return (
                                <div key={kg.id} className="group flex items-center space-x-2 p-2 bg-gray-100/50 dark:bg-gray-800/50 rounded-md">
                                    {wp ? (
                                        <WorkPackageIcon className="w-5 h-5 text-secondary dark:text-text-secondary-dark flex-shrink-0" />
                                    ) : (
                                        <div className="w-5 h-5 flex-shrink-0" /> // Placeholder for alignment
                                    )}
                                    
                                    <p className="flex-grow text-sm">{kg.title}</p>
                                    
                                    {kg.convertedToWpId ? (
                                        <button onClick={() => handleViewWp(kg.convertedToWpId!)} className="text-sm text-primary dark:text-blue-400 hover:underline">View WP</button>
                                    ) : (
                                        <button onClick={() => handleConvertKg(kg)} className="text-sm text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity">Convert to WP</button>
                                    )}
                                    <button onClick={() => handleDeleteKnowledgeGap(kg.id)} className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                        <TrashIcon className="w-4 h-4"/>
                                    </button>
                                </div>
                            )})
                        ) : (
                             <p className="text-sm text-center py-4 text-text-secondary dark:text-text-secondary-dark">No knowledge gaps defined.</p>
                        )}
                    </div>
                    <div className="flex items-center space-x-2">
                        <input 
                            type="text" 
                            placeholder="Define a new knowledge gap..." 
                            value={newKgText} 
                            onChange={e => setNewKgText(e.target.value)} 
                            onKeyDown={e => e.key === 'Enter' && handleAddKnowledgeGap()}
                            className="flex-grow p-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"
                        />
                         <select
                            value={newKgAssignee}
                            onChange={(e) => setNewKgAssignee(e.target.value)}
                            className="p-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"
                         >
                            <option value="" disabled>Assign to...</option>
                            {allPersons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                         </select>
                         <button onClick={handleAddKnowledgeGap} className="p-2 text-primary hover:bg-primary/10 rounded-full"><PlusIcon/></button>
                    </div>
                </div>
            </div>
            
            <div className="p-4 border-t border-border-light dark:border-border-dark bg-background dark:bg-background-dark flex justify-between items-center text-xs text-text-secondary dark:text-text-secondary-dark">
                <span>Created: {new Date(decision.createdAt).toLocaleDateString()}</span>
                <button onClick={() => onDelete(decision.id)} className="text-red-500 hover:text-red-700 dark:hover:text-red-400 p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                    <TrashIcon />
                </button>
                <span>Updated: {new Date(decision.updatedAt).toLocaleDateString()}</span>
            </div>
        </div>
    );
};
