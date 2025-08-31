
import React, { useState } from 'react';
import { Task, Person, Attachment, BlockageDetails, ItemStatus, LogAction, ItemType, Tag } from '../types';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { XIcon } from './icons/XIcon';
import { PaperclipIcon } from './icons/PaperclipIcon';
import { TrashIcon } from './icons/TrashIcon';

interface BlockTaskModalProps {
    task: Task;
    onClose: () => void;
}

export const BlockTaskModal: React.FC<BlockTaskModalProps> = ({ task, onClose }) => {
    const { upsertItem, getPersons, getAiConfig, getTags, upsertTag, addLogEntry } = useTasks();
    const { currentUserId } = useAuth();
    const allPersons = getPersons();
    const allTags = getTags();
    const aiConfig = getAiConfig();

    const [details, setDetails] = useState('');
    const [assigneeId, setAssigneeId] = useState('');
    const [blockerTag, setBlockerTag] = useState('');
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            if (typeof event.target?.result === 'string') {
                const newAttachment: Attachment = {
                    id: crypto.randomUUID(),
                    fileName: file.name,
                    mimeType: file.type,
                    data: event.target.result,
                };
                setAttachments(prev => [...prev, newAttachment]);
            }
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // Reset file input
    };

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(att => att.id !== id));
    };

    const handleSave = () => {
        if (!details.trim() || !assigneeId || !blockerTag) {
            alert('Please provide details, select an assignee, and choose a block type.');
            return;
        }
        if (!currentUserId) return;

        setIsSaving(true);
        
        let tag = allTags.find(t => t.name.toLowerCase() === blockerTag.toLowerCase());
        if (!tag) {
            tag = { id: crypto.randomUUID(), name: blockerTag };
            upsertTag(tag, currentUserId);
        }

        const blockageDetails: BlockageDetails = {
            reporterId: currentUserId,
            assigneeId,
            details,
            createdAt: new Date().toISOString(),
            attachments,
        };
        
        upsertItem({
            id: task.id,
            status: ItemStatus.Blocked,
            isBlocked: true,
            blockageDetails: blockageDetails,
            tagIds: Array.from(new Set([...(task.tagIds || []), tag.id]))
        }, currentUserId);

        const assigneeName = allPersons.find(p => p.id === assigneeId)?.name || 'Unknown';
        addLogEntry({
            userId: currentUserId,
            action: LogAction.BLOCK,
            details: `Task "${task.title}" blocked by "${blockerTag}". Assigned to ${assigneeName}.`,
            targetId: task.id,
            targetType: ItemType.Task,
        });
        
        setIsSaving(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in-fast">
             <style>{`
                .animate-fade-in-fast { animation: fadeIn 0.15s ease-out forwards; }
                @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
            `}</style>
            <div className="bg-surface dark:bg-surface-dark rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold text-text-primary dark:text-text-primary-dark">Report Blockage</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-700">
                        <XIcon className="w-6 h-6" />
                    </button>
                </header>

                <main className="flex-1 p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Task</label>
                        <p className="font-semibold text-text-primary dark:text-text-primary-dark">{task.title}</p>
                    </div>
                    <div>
                        <label htmlFor="details" className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Blockage Details</label>
                        <textarea
                            id="details"
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            rows={4}
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"
                            placeholder="Describe why this task is blocked..."
                        />
                    </div>
                    <div>
                        <label htmlFor="assignee" className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Assign To</label>
                        <select
                            id="assignee"
                            value={assigneeId}
                            onChange={(e) => setAssigneeId(e.target.value)}
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"
                        >
                            <option value="" disabled>Select a person...</option>
                            {allPersons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="blockerTag" className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Block Type</label>
                        <select
                            id="blockerTag"
                            value={blockerTag}
                            onChange={(e) => setBlockerTag(e.target.value)}
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"
                        >
                            <option value="" disabled>Select a block type...</option>
                            {(aiConfig?.blockerTags || []).map(tagName => <option key={tagName} value={tagName}>{tagName}</option>)}
                        </select>
                    </div>
                    <div>
                         <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Attachments</label>
                         <div className="mt-1 space-y-2">
                            {attachments.map(att => (
                                <div key={att.id} className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-800 rounded-md">
                                    <div className="flex items-center space-x-2 truncate">
                                        <PaperclipIcon className="w-4 h-4 flex-shrink-0" />
                                        <span className="text-sm truncate">{att.fileName}</span>
                                    </div>
                                    <button onClick={() => removeAttachment(att.id)} className="p-1 text-red-500 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                         </div>
                         <label htmlFor="file-upload" className="mt-2 w-full flex items-center justify-center px-4 py-2 text-sm text-primary border-2 border-dashed border-primary/50 rounded-lg hover:bg-primary/10 cursor-pointer">
                            <PaperclipIcon className="w-5 h-5 mr-2" />
                            Attach Photo or Video
                         </label>
                         <input id="file-upload" type="file" accept="image/*,video/*" onChange={handleFileChange} className="hidden" />
                    </div>
                </main>

                 <footer className="p-4 border-t border-border-light dark:border-border-dark flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                        {isSaving ? 'Saving...' : 'Save Blockage'}
                    </button>
                </footer>
            </div>
        </div>
    );
};