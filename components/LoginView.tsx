import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { SparklesIcon } from './icons/SparklesIcon';

type ViewMode = 'signIn' | 'signUp' | 'forgotPassword';

export const LoginView: React.FC = () => {
    const { login, signup, sendPasswordReset } = useAuth();

    const [mode, setMode] = useState<ViewMode>('signIn');
    
    // Form state
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(true);
    
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);


    const resetFormState = () => {
        setName('');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setError(null);
        setInfo(null);
        setIsLoading(false);
    };

    const handleModeChange = (newMode: ViewMode) => {
        resetFormState();
        setMode(newMode);
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setInfo(null);
        setIsLoading(true);

        try {
            if (mode === 'signUp') {
                if (password !== confirmPassword) throw new Error("Passwords do not match.");
                if (password.length < 6) throw new Error("Password must be at least 6 characters long.");
                await signup(name, email, password);
            } else if (mode === 'signIn') {
                await login(email, password, rememberMe);
            } else if (mode === 'forgotPassword') {
                await sendPasswordReset(email);
                setInfo("Password reset email sent! Check your inbox.");
            }
        } catch (err) {
            if (err instanceof Error) {
                // Firebase provides user-friendly error messages
                setError(err.message);
            } else {
                setError("An unknown error occurred.");
            }
        } finally {
            setIsLoading(false);
        }
    };
    
    const renderTitle = () => {
        switch(mode) {
            case 'signIn': return 'Welcome Back';
            case 'signUp': return 'Create an Account';
            case 'forgotPassword': return 'Forgot Password';
        }
    }
    
     const renderSubtitle = () => {
        switch(mode) {
            case 'signIn': return 'Sign in to continue.';
            case 'signUp': return 'Get started with your new account.';
            case 'forgotPassword': return 'Enter your email to recover your account.';
        }
    }

    const renderFormContent = () => {
        switch(mode) {
            case 'signIn':
                return (
                    <>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Email address</label>
                            <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                         <div>
                             <div className="flex items-center justify-between">
                                <label htmlFor="password" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Password</label>
                                <div className="text-sm">
                                    <button type="button" onClick={() => handleModeChange('forgotPassword')} className="font-medium text-primary hover:text-primary/90">Forgot password?</button>
                                </div>
                            </div>
                            <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <input id="remember-me" name="remember-me" type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"/>
                                <label htmlFor="remember-me" className="ml-2 block text-sm text-text-secondary dark:text-text-secondary-dark">Remember me</label>
                            </div>
                        </div>
                    </>
                );
            case 'signUp':
                return (
                     <>
                         <div>
                            <label htmlFor="name" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Full Name</label>
                            <input id="name" name="name" type="text" required value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                        <div>
                            <label htmlFor="email-signup" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Email address</label>
                            <input id="email-signup" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                         <div>
                            <label htmlFor="password-signup" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Password</label>
                            <input id="password-signup" name="password" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                        <div>
                            <label htmlFor="confirm-password" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Confirm Password</label>
                            <input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                    </>
                );
            case 'forgotPassword':
                return (
                     <div>
                        <label htmlFor="email-forgot" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Email address</label>
                        <input id="email-forgot" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                    </div>
                );
        }
    }


    return (
        <div className="w-full h-full flex items-center justify-center bg-background dark:bg-background-dark p-4">
            <div className="max-w-sm w-full">
                 <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center bg-primary/10 dark:bg-primary/20 text-primary p-4 rounded-full mb-4">
                        <SparklesIcon className="w-8 h-8" />
                    </div>
                    <h1 className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">{renderTitle()}</h1>
                    <p className="mt-1 text-text-secondary dark:text-text-secondary-dark">{renderSubtitle()}</p>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    {renderFormContent()}
                    {error && <p className="text-sm text-red-500">{error}</p>}
                    {info && <p className="text-sm text-green-500">{info}</p>}
                    
                    <div>
                        <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50">
                            {isLoading ? 'Processing...' : (mode === 'signIn' ? 'Sign In' : mode === 'signUp' ? 'Sign Up' : 'Send Reset Email')}
                        </button>
                    </div>
                </form>

                <p className="mt-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                    {mode === 'signIn' ? "Don't have an account?" : 'Already have an account?'}{' '}
                    <button onClick={() => handleModeChange(mode === 'signIn' ? 'signUp' : 'signIn')} className="font-medium text-primary hover:text-primary/90">
                        {mode === 'signIn' ? 'Sign Up' : 'Sign In'}
                    </button>
                </p>
            </div>
        </div>
    );
};