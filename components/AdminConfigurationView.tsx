
import React, { useState, useEffect } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { AiConfig } from '../types';
import { TrashIcon } from './icons/TrashIcon';
import { PlusIcon } from './icons/PlusIcon';

const DEFAULT_CONFIG: AiConfig = {
    taskGenerationMasterPrompt: '',
    workPackageSubtaskGenerationMasterPrompt: '',
    blockerTags: [],
};

export const AdminConfigurationView: React.FC = () => {
    const { getAiConfig, setAiConfig } = useTasks();
    const { currentUserId } = useAuth();
    const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG);
    const [isLoading, setIsLoading] = useState(true);
    const [newBlockerTag, setNewBlockerTag] = useState('');

    useEffect(() => {
        const loadedConfig = getAiConfig();
        if (loadedConfig) {
            setConfig(loadedConfig);
        }
        setIsLoading(false);
    }, [getAiConfig]);

    const handleSave = () => {
        if (!currentUserId) {
            alert("Cannot save configuration, no acting user found.");
            return;
        }
        setAiConfig(config, currentUserId);
        alert("Configuration saved successfully!");
    };
    
    const handleAddBlockerTag = () => {
        if (newBlockerTag.trim() && !config.blockerTags?.includes(newBlockerTag.trim())) {
            setConfig(c => ({ ...c, blockerTags: [...(c.blockerTags || []), newBlockerTag.trim()] }));
            setNewBlockerTag('');
        }
    };
    
    const handleDeleteBlockerTag = (tagToDelete: string) => {
        setConfig(c => ({ ...c, blockerTags: (c.blockerTags || []).filter(t => t !== tagToDelete) }));
    };

    if (isLoading) {
        return <div className="p-6">Loading configuration...</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            <div className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark">
                <h2 className="text-xl font-bold mb-4">AI Feature Configuration</h2>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold">Task Step Generation</h3>
                        <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-2">
                            Master prompt for generating task steps. Available placeholders: <code>{`{taskName}`}</code>, <code>{`{userPrompt}`}</code>.
                        </p>
                        <textarea
                            value={config.taskGenerationMasterPrompt}
                            onChange={e => setConfig(c => ({ ...c, taskGenerationMasterPrompt: e.target.value }))}
                            rows={6}
                            className="w-full p-2 font-mono text-sm bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                        />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold">Work Package Sub-task Generation</h3>
                        <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-2">
                            Master prompt for breaking down work packages. The work package title will be appended automatically.
                        </p>
                        <textarea
                            value={config.workPackageSubtaskGenerationMasterPrompt}
                            onChange={e => setConfig(c => ({ ...c, workPackageSubtaskGenerationMasterPrompt: e.target.value }))}
                            rows={6}
                            className="w-full p-2 font-mono text-sm bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                        />
                    </div>
                     <div>
                        <h3 className="text-lg font-semibold">Blocker Tags</h3>
                        <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-2">
                            Define a list of tags that can be used when reporting a task blockage.
                        </p>
                        <div className="space-y-2">
                            {(config.blockerTags || []).map(tag => (
                                <div key={tag} className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-800 rounded-md">
                                    <span>{tag}</span>
                                    <button onClick={() => handleDeleteBlockerTag(tag)} className="p-1 text-red-500 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center space-x-2 mt-3">
                            <input
                                type="text"
                                value={newBlockerTag}
                                onChange={e => setNewBlockerTag(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddBlockerTag()}
                                placeholder="Add new blocker tag..."
                                className="flex-grow p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                            />
                            <button onClick={handleAddBlockerTag} className="p-2 text-white bg-primary rounded-md hover:bg-primary/90">
                                <PlusIcon className="w-5 h-5"/>
                            </button>
                        </div>
                    </div>
                </div>
                <div className="mt-6 flex justify-end">
                    <button
                        onClick={handleSave}
                        className="px-6 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90"
                    >
                        Save Configuration
                    </button>
                </div>
            </div>
        </div>
    );
};