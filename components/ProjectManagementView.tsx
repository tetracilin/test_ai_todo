
import React, { useState } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { Project, Phase, Milestone, PhaseType } from '../types';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { EditIcon } from './icons/EditIcon';
import { XIcon } from './icons/XIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

const emptyProject: Omit<Project, 'id' | 'creatorId' | 'createdAt' | 'updatedAt'> = {
    name: '',
    code: '',
    contractId: '',
    status: 'Not Started',
    phases: [],
};

const ProjectModal: React.FC<{
    project: Partial<Project>;
    onClose: () => void;
    onSave: (project: Partial<Project>) => void;
}> = ({ project: initialProject, onClose, onSave }) => {
    const [project, setProject] = useState(initialProject);

    const handleProjectChange = (field: keyof Project, value: any) => {
        setProject(p => ({ ...p, [field]: value }));
    };

    const handlePhaseChange = (phaseId: string, field: keyof Phase, value: any) => {
        const newPhases = (project.phases || []).map(p => p.id === phaseId ? { ...p, [field]: value } : p);
        setProject(p => ({ ...p, phases: newPhases }));
    };
    
    const handleMilestoneChange = (phaseId: string, msId: string, field: keyof Milestone, value: any) => {
        const newPhases = (project.phases || []).map(p => {
            if (p.id === phaseId) {
                const newMilestones = p.milestones.map(ms => ms.id === msId ? { ...ms, [field]: value } : ms);
                return { ...p, milestones: newMilestones };
            }
            return p;
        });
        setProject(p => ({ ...p, phases: newPhases }));
    }

    const addPhase = () => {
        const newPhase: Phase = { id: crypto.randomUUID(), type: PhaseType.Concept, milestones: [] };
        handleProjectChange('phases', [...(project.phases || []), newPhase]);
    };

    const deletePhase = (phaseId: string) => {
        handleProjectChange('phases', (project.phases || []).filter(p => p.id !== phaseId));
    };
    
    const addMilestone = (phaseId: string) => {
         const newMilestone: Milestone = { id: crypto.randomUUID(), name: '', plannedStartDate: null, plannedFinishDate: null, actualStartDate: null, actualFinishDate: null };
         const newPhases = (project.phases || []).map(p => {
            if (p.id === phaseId) {
                return { ...p, milestones: [...p.milestones, newMilestone] };
            }
            return p;
        });
        setProject(p => ({ ...p, phases: newPhases }));
    };

    const deleteMilestone = (phaseId: string, msId: string) => {
        const newPhases = (project.phases || []).map(p => {
            if (p.id === phaseId) {
                return { ...p, milestones: p.milestones.filter(ms => ms.id !== msId) };
            }
            return p;
        });
        setProject(p => ({ ...p, phases: newPhases }));
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in-fast">
             <style>{`.animate-fade-in-fast { animation: fadeIn 0.15s ease-out forwards; } @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }`}</style>
            <div className="bg-surface dark:bg-surface-dark rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold">{project.id ? 'Edit Project' : 'Create Project'}</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700"><XIcon /></button>
                </header>
                <main className="flex-1 p-6 space-y-6 overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium">Project Name</label>
                            <input type="text" value={project.name || ''} onChange={e => handleProjectChange('name', e.target.value)} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Status</label>
                            <input type="text" value={project.status || ''} onChange={e => handleProjectChange('status', e.target.value)} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Project Code</label>
                            <input type="text" value={project.code || ''} onChange={e => handleProjectChange('code', e.target.value)} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Contract ID</label>
                            <input type="text" value={project.contractId || ''} onChange={e => handleProjectChange('contractId', e.target.value)} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">Phases</h3>
                        {(project.phases || []).map(phase => (
                            <div key={phase.id} className="p-4 bg-gray-100/50 dark:bg-gray-800/50 rounded-lg border border-border-light dark:border-border-dark">
                                <div className="flex items-center space-x-4 mb-4">
                                    <select value={phase.type} onChange={e => handlePhaseChange(phase.id, 'type', e.target.value as PhaseType)} className="p-2 bg-white dark:bg-gray-700 rounded-md border-border-light dark:border-border-dark focus:ring-primary">
                                        {Object.values(PhaseType).map(pt => <option key={pt} value={pt}>{pt}</option>)}
                                    </select>
                                    <button onClick={() => deletePhase(phase.id)} className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold">Milestones</h4>
                                    {phase.milestones.map(ms => (
                                        <div key={ms.id} className="grid grid-cols-1 md:grid-cols-11 gap-2 items-center">
                                            <input type="text" placeholder="Milestone Name" value={ms.name || ''} onChange={e => handleMilestoneChange(phase.id, ms.id, 'name', e.target.value)} className="md:col-span-3 p-1.5 text-sm rounded bg-white dark:bg-gray-700"/>
                                            <input type="date" title="Planned Start" value={ms.plannedStartDate?.split('T')[0] || ''} onChange={e => handleMilestoneChange(phase.id, ms.id, 'plannedStartDate', e.target.value)} className="md:col-span-2 p-1.5 text-sm rounded bg-white dark:bg-gray-700"/>
                                            <input type="date" title="Planned Finish" value={ms.plannedFinishDate?.split('T')[0] || ''} onChange={e => handleMilestoneChange(phase.id, ms.id, 'plannedFinishDate', e.target.value)} className="md:col-span-2 p-1.5 text-sm rounded bg-white dark:bg-gray-700"/>
                                            <input type="date" title="Actual Start" value={ms.actualStartDate?.split('T')[0] || ''} onChange={e => handleMilestoneChange(phase.id, ms.id, 'actualStartDate', e.target.value)} className="md:col-span-2 p-1.5 text-sm rounded bg-white dark:bg-gray-700"/>
                                            <input type="date" title="Actual Finish" value={ms.actualFinishDate?.split('T')[0] || ''} onChange={e => handleMilestoneChange(phase.id, ms.id, 'actualFinishDate', e.target.value)} className="md:col-span-1 p-1.5 text-sm rounded bg-white dark:bg-gray-700"/>
                                            <button onClick={() => deleteMilestone(phase.id, ms.id)} className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full justify-self-center"><TrashIcon className="w-4 h-4"/></button>
                                        </div>
                                    ))}
                                    <button onClick={() => addMilestone(phase.id)} className="w-full text-sm text-primary p-1 rounded hover:bg-primary/10 flex items-center justify-center">
                                        <PlusIcon className="w-4 h-4 mr-1"/> Add Milestone
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button onClick={addPhase} className="w-full flex items-center justify-center p-2 text-sm text-primary border-2 border-dashed border-primary/50 rounded-lg hover:bg-primary/10">
                            <PlusIcon className="w-5 h-5 mr-2" />Add Phase
                        </button>
                    </div>
                </main>
                <footer className="p-4 border-t border-border-light dark:border-border-dark flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={() => onSave(project)} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Save Project</button>
                </footer>
            </div>
        </div>
    );
};

export const ProjectManagementView: React.FC = () => {
    const { getProjects, upsertProject, deleteProject } = useTasks();
    const { currentUserId } = useAuth();
    const projects = getProjects();
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<Partial<Project> | null>(null);

    const handleOpenModal = (project?: Project) => {
        setEditingProject(project || emptyProject);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setEditingProject(null);
        setIsModalOpen(false);
    };

    const handleSave = (project: Partial<Project>) => {
        if (!currentUserId) {
            alert("No user logged in.");
            return;
        }
        upsertProject(project as any, currentUserId);
        handleCloseModal();
    };

    const handleDelete = (projectId: string) => {
        if (!currentUserId) {
            alert("No user logged in.");
            return;
        }
        if (window.confirm("Are you sure you want to delete this project and all its associated data?")) {
            deleteProject(projectId, currentUserId);
        }
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {isModalOpen && editingProject && (
                <ProjectModal project={editingProject} onClose={handleCloseModal} onSave={handleSave} />
            )}
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold">Projects</h2>
                <button onClick={() => handleOpenModal()} className="flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">
                    <PlusIcon className="w-5 h-5 mr-2 -ml-1" /> New Project
                </button>
            </div>
            <div className="bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-text-secondary uppercase bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th scope="col" className="px-6 py-3">Name</th>
                            <th scope="col" className="px-6 py-3">Code</th>
                            <th scope="col" className="px-6 py-3">Contract ID</th>
                            <th scope="col" className="px-6 py-3">Status</th>
                            <th scope="col" className="px-6 py-3"><span className="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.length > 0 ? projects.map(p => (
                            <tr key={p.id} className="border-b dark:border-border-dark hover:bg-gray-50 dark:hover:bg-gray-600/20">
                                <th scope="row" className="px-6 py-4 font-medium whitespace-nowrap">{p.name}</th>
                                <td className="px-6 py-4">{p.code}</td>
                                <td className="px-6 py-4">{p.contractId}</td>
                                <td className="px-6 py-4">{p.status}</td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end space-x-2">
                                        <button onClick={() => handleOpenModal(p)} className="p-2 text-text-secondary hover:text-primary rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"><EditIcon className="w-5 h-5"/></button>
                                        <button onClick={() => handleDelete(p.id)} className="p-2 text-text-secondary hover:text-red-500 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"><TrashIcon className="w-5 h-5"/></button>
                                    </div>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={5} className="text-center py-10 text-text-secondary">No projects found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};