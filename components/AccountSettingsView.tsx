
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Person, SecurityQuestion } from '../types';

export const AccountSettingsView: React.FC = () => {
    const { currentUser, showMainApp, changePassword, setSecurityQuestions } = useAuth();

    // State for password change form
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [passwordChangeFeedback, setPasswordChangeFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [isPasswordLoading, setIsPasswordLoading] = useState(false);

    // State for security questions form
    const [q1, setQ1] = useState(currentUser?.securityQuestions?.[0]?.question || "What was the name of your first pet?");
    const [a1, setA1] = useState('');
    const [q2, setQ2] = useState(currentUser?.securityQuestions?.[1]?.question || "What city were you born in?");
    const [a2, setA2] = useState('');
    const [verificationPassword, setVerificationPassword] = useState('');
    const [sqFeedback, setSqFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [isSqLoading, setIsSqLoading] = useState(false);
    
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
            await changePassword(currentUser.id, oldPassword, newPassword);
            setPasswordChangeFeedback({ type: 'success', message: "Password updated successfully!" });
            setOldPassword('');
            setNewPassword('');
            setConfirmNewPassword('');
        } catch (err) {
            setPasswordChangeFeedback({ type: 'error', message: err instanceof Error ? err.message : "An unknown error occurred." });
        } finally {
            setIsPasswordLoading(false);
        }
    };
    
    const handleSqChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setSqFeedback(null);
        if (!q1.trim() || !a1.trim() || !q2.trim() || !a2.trim() || !verificationPassword.trim()) {
            setSqFeedback({ type: 'error', message: "All fields are required to set security questions."});
            return;
        }
        if (!currentUser) return;

        setIsSqLoading(true);
        try {
            await setSecurityQuestions(currentUser.id, verificationPassword, [{ question: q1, answer: a1 }, { question: q2, answer: a2 }]);
            setSqFeedback({ type: 'success', message: "Security questions updated successfully!"});
            setA1('');
            setA2('');
            setVerificationPassword('');
        } catch (err) {
            setSqFeedback({ type: 'error', message: err instanceof Error ? err.message : "An unknown error occurred."});
        } finally {
            setIsSqLoading(false);
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
                 <h1 className="text-xl font-bold">Account Settings</h1>
                 <button onClick={showMainApp} className="px-4 py-2 text-sm font-medium rounded-md text-text-primary dark:text-text-primary-dark hover:bg-gray-200 dark:hover:bg-gray-700">Back to App</button>
            </header>
            <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 max-w-4xl mx-auto w-full">
                {/* Change Password Section */}
                <section className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark">
                    <h2 className="text-lg font-semibold mb-4">Change Password</h2>
                    <form onSubmit={handlePasswordChange} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium">Current Password</label>
                            <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
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
                
                {/* Security Questions Section */}
                <section className="bg-surface dark:bg-surface-dark p-6 rounded-lg border border-border-light dark:border-border-dark">
                     <h2 className="text-lg font-semibold mb-2">Security Questions</h2>
                     <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">These questions are used to recover your account if you forget your password. Answers are case-sensitive.</p>
                     <form onSubmit={handleSqChange} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium">Question 1</label>
                            <input type="text" value={q1} onChange={e => setQ1(e.target.value)} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Answer 1</label>
                            <input type="password" value={a1} onChange={e => setA1(e.target.value)} required placeholder="Enter answer for question 1" className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                         <div>
                            <label className="block text-sm font-medium">Question 2</label>
                            <input type="text" value={q2} onChange={e => setQ2(e.target.value)} required className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Answer 2</label>
                            <input type="password" value={a2} onChange={e => setA2(e.target.value)} required placeholder="Enter answer for question 2" className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        <div className="pt-4 border-t border-border-light dark:border-border-dark">
                             <label className="block text-sm font-medium">Verify with Current Password</label>
                            <input type="password" value={verificationPassword} onChange={e => setVerificationPassword(e.target.value)} required placeholder="Enter current password to save" className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                        </div>
                        {sqFeedback && <p className={`text-sm ${sqFeedback.type === 'error' ? 'text-red-500' : 'text-green-500'}`}>{sqFeedback.message}</p>}
                         <div className="text-right">
                             <button type="submit" disabled={isSqLoading} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50">
                                {isSqLoading ? 'Saving...' : 'Save Security Questions'}
                            </button>
                        </div>
                     </form>
                </section>
            </main>
        </div>
    );
};
