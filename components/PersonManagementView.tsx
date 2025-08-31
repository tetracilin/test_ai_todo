
import React, { useState, useEffect } from 'react';
import { useTasks } from '../context/TaskContext';
import { useAuth } from '../context/AuthContext';
import { Person } from '../types';
import { EditIcon } from './icons/EditIcon';
import { TrashIcon } from './icons/TrashIcon';
import { PlusIcon } from './icons/PlusIcon';

export const PersonManagementView: React.FC = () => {
    const { upsertPerson, deletePerson } = useTasks();
    const { currentUserId, setCurrentUserId, users } = useAuth();
    
    const [formData, setFormData] = useState<Partial<Person>>({});
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        // Reset form if the component is re-rendered for another purpose.
        return () => {
            setFormData({});
            setIsEditing(false);
        };
    }, []);
    
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name?.trim()) {
            alert('Name is required.');
            return;
        }
        if (!currentUserId) {
            alert('Cannot save person, no acting user found.');
            return;
        }
        
        const personToSave: Person = {
            id: formData.id || crypto.randomUUID(),
            name: formData.name,
            email: formData.email || '',
            mobile: formData.mobile || '',
            avatarUrl: formData.avatarUrl,
            aiPrompt: formData.aiPrompt || '',
        };
        
        upsertPerson(personToSave, currentUserId);
        resetForm();
    };

    const handleEdit = (person: Person) => {
        setFormData(person);
        setIsEditing(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = (personId: string) => {
        if (users.length <= 1) {
            alert("You cannot delete the only user.");
            return;
        }
        if (!currentUserId) {
            alert('Cannot delete person, no acting user found.');
            return;
        }
        if (window.confirm('Are you sure you want to delete this person? This action cannot be undone.')) {
            if (personId === currentUserId) {
                const otherUser = users.find(p => p.id !== personId);
                setCurrentUserId(otherUser!.id);
            }
            deletePerson(personId, currentUserId);
            if(isEditing && formData.id === personId) {
                resetForm();
            }
        }
    };
    
    const resetForm = () => {
        setFormData({});
        setIsEditing(false);
    }
    
    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            <div className="bg-surface dark:bg-surface-dark p-4 rounded-lg border border-border-light dark:border-border-dark">
                <h3 className="text-lg font-semibold mb-4">{isEditing ? 'Edit Person' : 'Add New Person'}</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Name</label>
                            <input type="text" name="name" id="name" value={formData.name || ''} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Email</label>
                            <input type="email" name="email" id="email" value={formData.email || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                        </div>
                        <div>
                            <label htmlFor="mobile" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Mobile Number</label>
                            <input type="tel" name="mobile" id="mobile" value={formData.mobile || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"/>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="aiPrompt" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">AI Self-Description</label>
                        <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-1">Used by AI to tailor responses for you (e.g., "a junior frontend dev").</p>
                        <textarea
                            name="aiPrompt"
                            id="aiPrompt"
                            value={formData.aiPrompt || ''}
                            onChange={handleInputChange}
                            rows={3}
                            className="block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary focus:border-primary"
                            placeholder="e.g., a junior frontend developer specializing in React..."
                        />
                    </div>
                    <div className="flex justify-end space-x-2">
                        {isEditing && (
                             <button type="button" onClick={resetForm} className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                        )}
                        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 flex items-center">
                            <PlusIcon className="w-5 h-5 mr-2 -ml-1" />
                            {isEditing ? 'Save Changes' : 'Add Person'}
                        </button>
                    </div>
                </form>
            </div>
            
             <div className="bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
                <h3 className="text-lg font-semibold p-4 border-b border-border-light dark:border-border-dark">Existing Persons ({users.length})</h3>
                <ul className="divide-y divide-border-light dark:divide-border-dark">
                    {users.map(person => (
                        <li key={person.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark truncate">{person.name}</p>
                                <p className="text-sm text-text-secondary dark:text-text-secondary-dark truncate">{person.email}</p>
                                <p className="text-sm text-text-secondary dark:text-text-secondary-dark truncate">{person.mobile}</p>
                                {person.aiPrompt && <p className="text-xs text-text-secondary dark:text-text-secondary-dark italic mt-1 truncate">AI: "{person.aiPrompt}"</p>}
                            </div>
                            <div className="flex items-center space-x-2 ml-4">
                                <button onClick={() => handleEdit(person)} className="p-2 text-text-secondary dark:text-text-secondary-dark hover:text-primary rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                                    <EditIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => handleDelete(person.id)} className="p-2 text-text-secondary dark:text-text-secondary-dark hover:text-red-500 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50">
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};