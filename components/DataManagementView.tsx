
import React, { useState } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { toCSV, fromCSV } from '../services/csvService';
import { Item, ItemType, Project, Decision } from '../types';

const TASK_HEADERS = ['id', 'creatorId', 'title', 'note', 'createdAt', 'updatedAt', 'flagged', 'workPackageId', 'parentId', 'tagIds', 'dueDate', 'deferDate', 'scheduledTime', 'estimate', 'completedAt', 'status', 'dodId', 'isBlocked', 'blockageDetails', 'timerStartedAt', 'accumulatedTime', 'assigneeId', 'clarificationNotes'] as const;
const WORK_PACKAGE_HEADERS = ['id', 'creatorId', 'title', 'note', 'createdAt', 'updatedAt', 'flagged', 'parentId', 'workPackageType', 'status', 'completedAt', 'responsible', 'accountable', 'consulted', 'informed', 'plannedDeadline', 'definitionsOfDone', 'projectId'] as const;
const PROJECT_HEADERS = ['id', 'creatorId', 'name', 'code', 'contractId', 'status', 'phases', 'createdAt', 'updatedAt'] as const;
const DECISION_HEADERS = ['id', 'creatorId', 'title', 'projectId', 'parentId', 'knowledgeGaps', 'convertedToWpId', 'createdAt', 'updatedAt', 'status', 'plannedStartDate', 'plannedFinishDate', 'actualStartDate', 'actualFinishDate'] as const;

type DataType = 'tasks' | 'workPackages' | 'projects' | 'decisions';

export const DataManagementView: React.FC = () => {
    const { getItems, getProjects, getDecisions, importData } = useTasks();
    const { currentUserId } = useAuth();
    const [files, setFiles] = useState<Record<DataType, File | null>>({
        tasks: null,
        workPackages: null,
        projects: null,
        decisions: null,
    });
    const [feedback, setFeedback] = useState<Record<DataType, { type: 'success' | 'error', message: string } | null>>({
        tasks: null,
        workPackages: null,
        projects: null,
        decisions: null,
    });

    const triggerDownload = (filename: string, content: string) => {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleExport = (type: DataType) => {
        let data: any[] = [];
        let headers: readonly string[] = [];
        let filename = `${type}.csv`;

        switch (type) {
            case 'tasks':
                data = getItems().filter(i => i.type === ItemType.Task);
                headers = TASK_HEADERS;
                break;
            case 'workPackages':
                data = getItems().filter(i => i.type === ItemType.WorkPackage);
                headers = WORK_PACKAGE_HEADERS;
                break;
            case 'projects':
                data = getProjects();
                headers = PROJECT_HEADERS;
                break;
            case 'decisions':
                data = getDecisions();
                headers = DECISION_HEADERS;
                break;
        }

        const csvContent = toCSV(data, [...headers]);
        triggerDownload(filename, csvContent);
    };

    const handleFileChange = (type: DataType, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        setFiles(prev => ({ ...prev, [type]: file }));
        setFeedback(prev => ({ ...prev, [type]: null }));
    };

    const handleImport = (type: DataType) => {
        const file = files[type];
        if (!file || !currentUserId) {
            setFeedback(prev => ({...prev, [type]: {type: 'error', message: 'Please select a file first.'}}));
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            let headers: readonly string[] = [];
            switch(type) {
                case 'tasks': headers = TASK_HEADERS; break;
                case 'workPackages': headers = WORK_PACKAGE_HEADERS; break;
                case 'projects': headers = PROJECT_HEADERS; break;
                case 'decisions': headers = DECISION_HEADERS; break;
            }

            const result = fromCSV(text, [...headers]);
            
            if ('error' in result) {
                setFeedback(prev => ({...prev, [type]: {type: 'error', message: result.error}}));
            } else {
                importData(type, result, currentUserId);
                setFeedback(prev => ({...prev, [type]: {type: 'success', message: `Successfully imported ${result.length} records.`}}));
                setFiles(prev => ({ ...prev, [type]: null })); // Clear file input
            }
        };
        reader.onerror = () => {
             setFeedback(prev => ({...prev, [type]: {type: 'error', message: 'Error reading file.'}}));
        };
        reader.readAsText(file);
    };
    
    const ImportSection: React.FC<{ type: DataType, title: string }> = ({ type, title }) => (
        <div className="bg-gray-100/50 dark:bg-gray-800/50 p-4 rounded-lg">
            <h4 className="font-semibold mb-2">{title}</h4>
            <div className="flex items-center space-x-2">
                <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFileChange(type, e)}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                />
                <button
                    onClick={() => handleImport(type)}
                    disabled={!files[type]}
                    className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                    Import
                </button>
            </div>
            {feedback[type] && (
                <p className={`mt-2 text-sm ${feedback[type]?.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                    {feedback[type]?.message}
                </p>
            )}
        </div>
    );

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8">
            <div className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark">
                <h2 className="text-xl font-bold mb-2">Data Export</h2>
                <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
                    Download your application data as CSV files for backup or external use.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <button onClick={() => handleExport('tasks')} className="p-4 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors">Export Tasks</button>
                    <button onClick={() => handleExport('workPackages')} className="p-4 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-colors">Export Work Packages</button>
                    <button onClick={() => handleExport('projects')} className="p-4 bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-600 transition-colors">Export Projects</button>
                    <button onClick={() => handleExport('decisions')} className="p-4 bg-purple-500 text-white rounded-lg font-semibold hover:bg-purple-600 transition-colors">Export Decisions</button>
                </div>
            </div>

            <div className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark">
                 <h2 className="text-xl font-bold mb-2">Data Import</h2>
                <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-md mb-4" role="alert">
                    <p className="font-bold">Warning</p>
                    <p className="text-sm">Importing a file will <strong className="underline">replace all existing data</strong> of that type. This action cannot be undone. Please ensure you have a backup if needed.</p>
                </div>
                <div className="space-y-4">
                    <ImportSection type="tasks" title="Import Tasks" />
                    <ImportSection type="workPackages" title="Import Work Packages" />
                    <ImportSection type="projects" title="Import Projects" />
                    <ImportSection type="decisions" title="Import Decisions" />
                </div>
            </div>
        </div>
    );
};
