
import React, { useState } from 'react';
import { LeaveBlock, TodayViewConfig } from '../types';
import { useAuth } from '../context/AuthContext';
import { XIcon } from './icons/XIcon';

interface AddLeaveModalProps {
    todayConfig: TodayViewConfig;
    onClose: () => void;
    onAddLeave: (leaveBlock: Omit<LeaveBlock, 'id' | 'creatorId'>) => void;
}

const toTimeString = (hour: number, minute: number = 0) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
const getTodayDateString = () => new Date().toISOString().split('T')[0];

export const AddLeaveModal: React.FC<AddLeaveModalProps> = ({ todayConfig, onClose, onAddLeave }) => {
    const { currentUserId } = useAuth();
    const [title, setTitle] = useState('');

    const handleAddPreset = (type: 'all-day' | 'half-day-am' | 'half-day-pm' | '1-hour' | '2-hours') => {
        if (!currentUserId) {
            alert("No user is logged in.");
            return;
        }

        let leaveTitle = title.trim();
        let startTime: string;
        let endTime: string;

        switch (type) {
            case 'all-day':
                leaveTitle = leaveTitle || 'Away';
                startTime = toTimeString(todayConfig.startHour);
                endTime = toTimeString(todayConfig.endHour);
                break;
            case 'half-day-am':
                leaveTitle = leaveTitle || 'Away (AM)';
                startTime = toTimeString(todayConfig.startHour);
                endTime = toTimeString(todayConfig.startHour + 4);
                break;
            case 'half-day-pm':
                leaveTitle = leaveTitle || 'Away (PM)';
                startTime = toTimeString(todayConfig.endHour - 4);
                endTime = toTimeString(todayConfig.endHour);
                break;
            case '1-hour':
                leaveTitle = leaveTitle || 'Break';
                startTime = toTimeString(new Date().getHours(), new Date().getMinutes());
                endTime = toTimeString(new Date().getHours() + 1, new Date().getMinutes());
                break;
            case '2-hours':
                leaveTitle = leaveTitle || 'Break';
                startTime = toTimeString(new Date().getHours(), new Date().getMinutes());
                endTime = toTimeString(new Date().getHours() + 2, new Date().getMinutes());
                break;
        }
        
        onAddLeave({
            date: getTodayDateString(),
            title: leaveTitle,
            startTime,
            endTime
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in-fast">
             <style>{`.animate-fade-in-fast { animation: fadeIn 0.15s ease-out forwards; } @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }`}</style>
            <div className="bg-surface dark:bg-surface-dark rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
                <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold">Add Leave / Away Time</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">
                        <XIcon className="w-6 h-6" />
                    </button>
                </header>
                <main className="flex-1 p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label htmlFor="leaveTitle" className="text-sm font-medium">Title (Optional)</label>
                        <input
                            id="leaveTitle"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g., Lunch, Doctor's Appointment"
                            className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => handleAddPreset('1-hour')} className="p-3 text-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium">1 Hour</button>
                        <button onClick={() => handleAddPreset('2-hours')} className="p-3 text-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium">2 Hours</button>
                        <button onClick={() => handleAddPreset('half-day-am')} className="p-3 text-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium">Half Day (AM)</button>
                        <button onClick={() => handleAddPreset('half-day-pm')} className="p-3 text-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium">Half Day (PM)</button>
                    </div>
                    <button onClick={() => handleAddPreset('all-day')} className="w-full p-3 text-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium">All Day</button>
                </main>
            </div>
        </div>
    );
};
