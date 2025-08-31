
import React, { useState, useMemo } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { Decision, KnowledgeGap, Person, WorkPackage, DecisionStatus } from '../types';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { InfoIcon } from './icons/InfoIcon';
import { BriefcaseIcon } from './icons/BriefcaseIcon';
import { CircleIcon } from './icons/CircleIcon';
import { OnGoingIcon } from './icons/OnGoingIcon';
import { PendingIcon } from './icons/PendingIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { XCircleIcon } from './icons/XCircleIcon';


const getPersonName = (personId: string, allPersons: Person[]) => {
    return allPersons.find(p => p.id === personId)?.name || 'Unassigned';
};

const StatusIcon: React.FC<{ status: DecisionStatus }> = ({ status }) => {
    switch (status) {
        case DecisionStatus.ToDo:
            return <CircleIcon className="w-5 h-5 text-gray-400" title="To Do" />;
        case DecisionStatus.OnGoing:
            return <OnGoingIcon className="w-5 h-5 text-blue-500" title="On-going" />;
        case DecisionStatus.Pending:
            return <PendingIcon className="w-5 h-5 text-yellow-500" title="Pending" />;
        case DecisionStatus.Done:
            return <CheckCircleIcon className="w-5 h-5 text-green-500" title="Done" />;
        case DecisionStatus.Closed:
            return <XCircleIcon className="w-5 h-5 text-red-500" title="Closed" />;
        default:
            return <CircleIcon className="w-5 h-5 text-gray-400" />;
    }
};

const RecursiveDecisionRow: React.FC<{
    decision: Decision;
    level: number;
    allDecisions: Decision[];
    allPersons: Person[];
    onSelectItem: (id: string) => void;
    onDelete: (id: string) => void;
    onConvertToDecisionWp: (decision: Decision) => void;
    onConvertToKgWp: (kg: KnowledgeGap, decisionId: string, projectId: string) => void;
    onViewWp: (wpId: string) => void;
}> = ({ decision, level, allDecisions, allPersons, onSelectItem, onDelete, onConvertToDecisionWp, onConvertToKgWp, onViewWp }) => {

    const { getItems } = useTasks();
    const childDecisions = useMemo(() => {
        return allDecisions.filter(d => d.parentId === decision.id);
    }, [allDecisions, decision.id]);
    
    const decisionWorkPackage = useMemo(() => {
        if (!decision.convertedToWpId) return null;
        return getItems().find(i => i.id === decision.convertedToWpId) as WorkPackage | undefined;
    }, [decision.convertedToWpId, getItems]);

    return (
        <>
            <tr className="bg-surface dark:bg-surface-dark border-b dark:border-border-dark group">
                <td className="px-4 py-3 align-top">
                    <div style={{ paddingLeft: `${level * 2}rem` }}>
                        <div className="flex items-center">
                             <div className="mr-2 flex-shrink-0">
                                <StatusIcon status={decision.status} />
                            </div>
                             <div className="font-semibold text-text-primary dark:text-text-primary-dark">{decision.title}</div>
                        </div>
                       
                        {decision.knowledgeGaps && decision.knowledgeGaps.length > 0 && (
                            <div className="mt-2 pl-4 space-y-2">
                                {decision.knowledgeGaps.map(kg => {
                                    const kgWorkPackage = kg.convertedToWpId ? getItems().find(i => i.id === kg.convertedToWpId) : null;
                                    return (
                                        <div key={kg.id} className="text-xs flex items-center justify-between text-text-secondary dark:text-text-secondary-dark p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700/50">
                                            <div 
                                                className="flex-grow cursor-pointer"
                                                onClick={() => onSelectItem(decision.id)}
                                            >
                                                <span className="font-medium">{kg.title}</span>
                                                <span className="italic ml-2">({getPersonName(kg.assigneeId, allPersons)})</span>
                                            </div>
                                            <div className="flex-shrink-0 ml-4">
                                                {kgWorkPackage ? (
                                                    <button onClick={() => onViewWp(kgWorkPackage.id)} className="text-green-600 dark:text-green-400 hover:underline font-semibold">View WP</button>
                                                ) : (
                                                    <button onClick={() => onConvertToKgWp(kg, decision.id, decision.projectId)} className="text-blue-600 dark:text-blue-400 hover:underline">Convert to WP</button>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </td>
                <td className="px-4 py-3 align-top text-right">
                    <div className="flex items-center justify-end space-x-2">
                        {decisionWorkPackage ? (
                            <button onClick={() => onViewWp(decisionWorkPackage.id)} className="flex items-center text-xs px-2 py-1 font-semibold text-green-700 bg-green-100 rounded-full dark:bg-green-900/50 dark:text-green-300">
                                <BriefcaseIcon className="w-4 h-4 mr-1.5" />
                                View WP
                            </button>
                        ) : (
                            <button onClick={() => onConvertToDecisionWp(decision)} className="flex items-center text-xs px-2 py-1 font-semibold text-indigo-700 bg-indigo-100 rounded-full dark:bg-indigo-900/50 dark:text-indigo-300 opacity-50 group-hover:opacity-100 transition-opacity">
                                <BriefcaseIcon className="w-4 h-4 mr-1.5" />
                                Convert
                            </button>
                        )}
                        <button onClick={() => onSelectItem(decision.id)} className="p-2 text-text-secondary dark:text-text-secondary-dark hover:text-primary rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 opacity-50 group-hover:opacity-100 transition-opacity" aria-label="View details">
                            <InfoIcon className="w-5 h-5"/>
                        </button>
                        <button onClick={() => onDelete(decision.id)} className="p-2 text-text-secondary dark:text-text-secondary-dark hover:text-red-500 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 opacity-50 group-hover:opacity-100 transition-opacity" aria-label="Delete decision">
                            <TrashIcon className="w-5 h-5"/>
                        </button>
                    </div>
                </td>
            </tr>
            {childDecisions.map(child => (
                <RecursiveDecisionRow
                    key={child.id}
                    decision={child}
                    level={level + 1}
                    allDecisions={allDecisions}
                    allPersons={allPersons}
                    onSelectItem={onSelectItem}
                    onDelete={onDelete}
                    onConvertToDecisionWp={onConvertToDecisionWp}
                    onConvertToKgWp={onConvertToKgWp}
                    onViewWp={onViewWp}
                />
            ))}
        </>
    );
};


export const DecisionTableView: React.FC<{
    onSelectItem: (id: string) => void;
    setActiveView: (view: string) => void;
}> = ({ onSelectItem, setActiveView }) => {
    const { getProjects, getDecisions, upsertDecision, deleteDecision, convertKnowledgeGapToWp, convertDecisionToWp, getPersons } = useTasks();
    const { currentUserId } = useAuth();
    const projects = getProjects();
    const allDecisions = getDecisions();
    const allPersons = getPersons();

    const [projectFilter, setProjectFilter] = useState<string>(projects.length > 0 ? projects[0].id : '');

    const { rootDecisions, decisionMap } = useMemo(() => {
        if (!projectFilter) return { rootDecisions: [], decisionMap: new Map() };
        const filtered = allDecisions.filter(d => d.projectId === projectFilter);
        const map = new Map(filtered.map(d => [d.id, d]));
        const roots = filtered.filter(d => !d.parentId || !map.has(d.parentId));
        return { rootDecisions: roots, decisionMap: map };
    }, [projectFilter, allDecisions]);

    const handleAddDecision = () => {
        if (!currentUserId || !projectFilter) {
            alert("Please select a project first.");
            return;
        }
        const newDecision: Partial<Decision> & { id: string } = {
            id: crypto.randomUUID(),
            title: 'New Decision',
            projectId: projectFilter,
            parentId: null,
            knowledgeGaps: [],
            convertedToWpId: null,
        };
        upsertDecision(newDecision, currentUserId);
        onSelectItem(newDecision.id);
    };
    
    const handleDeleteDecision = (decisionId: string) => {
        if(!currentUserId) return;
        if(window.confirm("Are you sure you want to delete this decision and all of its descendants? This action cannot be undone.")) {
            deleteDecision(decisionId, currentUserId);
        }
    };
    
    const handleConvertToKgWp = (kg: KnowledgeGap, decisionId: string, projectId: string) => {
        if (!currentUserId) return;
        convertKnowledgeGapToWp(kg, decisionId, projectId, currentUserId);
    };

    const handleConvertToDecisionWp = (decision: Decision) => {
        if (!currentUserId) return;
        convertDecisionToWp(decision, currentUserId);
    };

    const handleViewWp = (wpId: string) => {
        setActiveView(`workPackage/${wpId}`);
        onSelectItem(wpId);
    };

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-2 md:space-y-0">
                <div className="flex-grow">
                    <label htmlFor="project-filter" className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Project</label>
                    <select id="project-filter" value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="mt-1 block w-full md:max-w-xs p-2 bg-surface dark:bg-surface-dark rounded-md border border-border-light dark:border-border-dark focus:ring-primary focus:border-primary">
                        {projects.length > 0 ? (
                            projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                        ) : (
                            <option value="" disabled>Please create a project first</option>
                        )}
                    </select>
                </div>
                <button onClick={handleAddDecision} disabled={!projectFilter} className="flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                    <PlusIcon className="w-5 h-5 mr-2 -ml-1" /> New Decision
                </button>
            </div>
            
            <div className="bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                                <th scope="col" className="px-4 py-3 w-3/4">Decision & Knowledge Gaps</th>
                                <th scope="col" className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                             {rootDecisions.length > 0 ? (
                                rootDecisions.map(decision => (
                                    <RecursiveDecisionRow 
                                        key={decision.id} 
                                        decision={decision}
                                        level={0}
                                        allDecisions={Array.from(decisionMap.values())}
                                        allPersons={allPersons}
                                        onSelectItem={onSelectItem}
                                        onDelete={handleDeleteDecision}
                                        onConvertToDecisionWp={handleConvertToDecisionWp}
                                        onConvertToKgWp={handleConvertToKgWp}
                                        onViewWp={handleViewWp}
                                    />
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={2} className="text-center py-10 text-text-secondary dark:text-text-secondary-dark">
                                        <p>{projectFilter ? 'No decisions for this project.' : 'Please select a project.'}</p>
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