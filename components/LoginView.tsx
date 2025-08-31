
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTasks } from '../context/TaskContext';
import { Person, SecurityQuestion } from '../types';
import { GoogleIcon } from './icons/GoogleIcon';
import { SparklesIcon } from './icons/SparklesIcon';

type ViewMode = 'signIn' | 'signUp' | 'forgotPasswordEmail' | 'forgotPasswordQuestions' | 'forgotPasswordReset';

export const LoginView: React.FC = () => {
    const { users, setCurrentUserId, login, signup, loginTargetEmail, findUserByEmail, verifySecurityAnswers, resetPassword } = useAuth();
    const { upsertPerson } = useTasks();

    const [mode, setMode] = useState<ViewMode>('signIn');
    
    // Form state
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(true);
    const [answer1, setAnswer1] = useState('');
    const [answer2, setAnswer2] = useState('');
    
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // State for forgot password flow
    const [forgotPasswordUser, setForgotPasswordUser] = useState<Person | null>(null);

    useEffect(() => {
        if (loginTargetEmail) {
            setEmail(loginTargetEmail);
        }
    }, [loginTargetEmail]);

    const handleGoogleSignIn = () => {
        const googleUserEmail = 'google.user@example.com';
        let user = users.find(p => p.email === googleUserEmail);

        if (!user) {
            const newUser: Person = {
                id: crypto.randomUUID(), name: 'Sample User', email: googleUserEmail, mobile: '', avatarUrl: '',
                aiPrompt: 'A busy professional using Gemini Task Manager.',
            };
            upsertPerson(newUser, newUser.id);
            user = newUser;
        }

        // Google sign-in implies remembering the user
        localStorage.setItem('gemini-task-manager-userId', user.id);
        setCurrentUserId(user.id);
    };

    const resetFormState = () => {
        setName('');
        setEmail(loginTargetEmail || '');
        setPassword('');
        setConfirmPassword('');
        setAnswer1('');
        setAnswer2('');
        setError(null);
        setIsLoading(false);
    };

    const handleModeChange = (newMode: ViewMode) => {
        resetFormState();
        setMode(newMode);
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            if (mode === 'signUp') {
                if (password !== confirmPassword) throw new Error("Passwords do not match.");
                await signup(name, email, password);
            } else if (mode === 'signIn') {
                await login(email, password, rememberMe);
            } else if (mode === 'forgotPasswordEmail') {
                const user = await findUserByEmail(email);
                if (user && user.securityQuestions && user.securityQuestions.length === 2) {
                    setForgotPasswordUser(user);
                    handleModeChange('forgotPasswordQuestions');
                } else {
                    throw new Error("No account found with that email or security questions are not set up.");
                }
            } else if (mode === 'forgotPasswordQuestions') {
                if (!forgotPasswordUser) return;
                const isVerified = await verifySecurityAnswers(forgotPasswordUser.id, [answer1, answer2]);
                if (isVerified) {
                    handleModeChange('forgotPasswordReset');
                } else {
                    throw new Error("One or more answers are incorrect.");
                }
            } else if (mode === 'forgotPasswordReset') {
                if (!forgotPasswordUser) return;
                if (password !== confirmPassword) throw new Error("Passwords do not match.");
                await resetPassword(forgotPasswordUser.id, password);
                alert("Password has been reset successfully. Please sign in.");
                setForgotPasswordUser(null);
                handleModeChange('signIn');
            }
        } catch (err) {
            if (err instanceof Error) {
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
            case 'forgotPasswordEmail': return 'Forgot Password';
            case 'forgotPasswordQuestions': return 'Security Questions';
            case 'forgotPasswordReset': return 'Reset Your Password';
        }
    }
    
     const renderSubtitle = () => {
        switch(mode) {
            case 'signIn': return 'Sign in to continue.';
            case 'signUp': return 'Get started with your new account.';
            case 'forgotPasswordEmail': return 'Enter your email to recover your account.';
            case 'forgotPasswordQuestions': return `Answer the questions for ${forgotPasswordUser?.email}`;
            case 'forgotPasswordReset': return 'Enter your new password.';
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
                                    <button type="button" onClick={() => handleModeChange('forgotPasswordEmail')} className="font-medium text-primary hover:text-primary/90">Forgot password?</button>
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
                            <label htmlFor="name" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Name</label>
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
            case 'forgotPasswordEmail':
                return (
                     <div>
                        <label htmlFor="email-forgot" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Email address</label>
                        <input id="email-forgot" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                    </div>
                );
            case 'forgotPasswordQuestions':
                return (
                     <>
                         <div>
                            <label htmlFor="answer1" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">{forgotPasswordUser?.securityQuestions?.[0].question}</label>
                            <input id="answer1" name="answer1" type="text" required value={answer1} onChange={e => setAnswer1(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                        <div>
                            <label htmlFor="answer2" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">{forgotPasswordUser?.securityQuestions?.[1].question}</label>
                            <input id="answer2" name="answer2" type="text" required value={answer2} onChange={e => setAnswer2(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                     </>
                );
            case 'forgotPasswordReset':
                return (
                    <>
                        <div>
                            <label htmlFor="new-password" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">New Password</label>
                            <input id="new-password" name="password" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                        <div>
                            <label htmlFor="confirm-new-password" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Confirm New Password</label>
                            <input id="confirm-new-password" name="confirm-password" type="password" autoComplete="new-password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary"/>
                        </div>
                    </>
                )
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
                    
                    <div>
                        <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50">
                            {isLoading ? 'Processing...' : (mode === 'signIn' ? 'Sign In' : mode === 'signUp' ? 'Sign Up' : 'Continue')}
                        </button>
                    </div>
                </form>

                {mode === 'signIn' || mode === 'signUp' ? (
                    <>
                        <div className="mt-6 relative">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border-light dark:border-border-dark" /></div>
                            <div className="relative flex justify-center text-sm"><span className="px-2 bg-background dark:bg-background-dark text-text-secondary dark:text-text-secondary-dark">Or continue with</span></div>
                        </div>

                        <div className="mt-6">
                            <button onClick={handleGoogleSignIn} className="w-full inline-flex items-center justify-center px-4 py-2 border border-border-light dark:border-border-dark rounded-md shadow-sm bg-surface dark:bg-surface-dark text-sm font-medium text-text-primary dark:text-text-primary-dark hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary dark:focus:ring-offset-background-dark">
                                <GoogleIcon className="w-5 h-5 mr-3" />
                                Sign in with Google
                            </button>
                        </div>

                        <p className="mt-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                            {mode === 'signUp' ? 'Already have an account?' : "Don't have an account?"}{' '}
                            <button onClick={() => handleModeChange(mode === 'signUp' ? 'signIn' : 'signUp')} className="font-medium text-primary hover:text-primary/90">
                                {mode === 'signUp' ? 'Sign In' : 'Sign Up'}
                            </button>
                        </p>
                    </>
                ) : (
                    <p className="mt-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                        Remember your password?{' '}
                        <button onClick={() => handleModeChange('signIn')} className="font-medium text-primary hover:text-primary/90">
                            Sign In
                        </button>
                    </p>
                )}
            </div>
        </div>
    );
};
