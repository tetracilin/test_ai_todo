import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Person } from '../types';

export const AccountSettingsView: React.FC = () => {
    const { currentUser, showMainApp, changePassword, firebaseUser } = useAuth();

    // State for password change form
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [passwordChangeFeedback, setPasswordChangeFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [isPasswordLoading, setIsPasswordLoading] = useState(false);

    
    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordChangeFeedback(null);
        if (newPassword !== confirmNewPassword) {
            setPasswordChangeFeedback({ type: 'error', message: "New passwords do not match." });
            return;
        }
        if (!currentUser) return;

        setIsPasswordLoading(true);
        try {
            await changePassword(newPassword);
            setPasswordChangeFeedback({ type: 'success', message: "Password updated successfully!" });
            setNewPassword('');
            setConfirmNewPassword('');
        } catch (err) {
            setPasswordChangeFeedback({ type: 'error', message: err instanceof Error ? err.message : "An unknown error occurred." });
        } finally {
            setIsPasswordLoading(false);
        }
    };

    if (!currentUser) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-background dark:bg-background-dark p-4">
                <p className="text-text-secondary dark:text-text-secondary-dark mb-4">You must be logged in to view account settings.</p>
                <button onClick={showMainApp} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Go to Login</button>
            </div>
        );
    }
    
    return (
        <div className="h-screen w-screen flex flex-col bg-background dark:bg-background-dark">
            <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center flex-shrink-0">
                 <h1 className="text-xl font-bold">Account Settings for {currentUser.name}</h1>
                 <button onClick={showMainApp} className="px-4 py-2 text-sm font-medium rounded-md text-text-primary dark:text-text-primary-dark hover:bg-gray-200 dark:hover:bg-gray-700">Back to App</button>
            </header>
            <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 max-w-4xl mx-auto w-full">
                {/* Change Password Section */}
                <section className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark">
                    <h2 className="text-lg font-semibold mb-4">Change Password</h2>
                    <form onSubmit={handlePasswordChange} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium">New Password</label>
                            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Confirm New Password</label>
                            <input type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        {passwordChangeFeedback && <p className={`text-sm ${passwordChangeFeedback.type === 'error' ? 'text-red-500' : 'text-green-500'}`}>{passwordChangeFeedback.message}</p>}
                        <div className="text-right">
                             <button type="submit" disabled={isPasswordLoading} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                                {isPasswordLoading ? 'Saving...' : 'Save Password'}
                            </button>
                        </div>
                    </form>
                </section>
            </main>
        </div>
    );
};