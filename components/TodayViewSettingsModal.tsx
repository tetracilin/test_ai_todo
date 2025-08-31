
import React, { useState } from 'react';
import { TodayViewConfig } from '../types';
import { XIcon } from './icons/XIcon';

interface TodayViewSettingsModalProps {
    config: TodayViewConfig;
    onClose: () => void;
    onSave: (newConfig: TodayViewConfig) => void;
}

export const TodayViewSettingsModal: React.FC<TodayViewSettingsModalProps> = ({ config, onClose, onSave }) => {
    const [currentConfig, setCurrentConfig] = useState(config);

    const handleSave = () => {
        if (currentConfig.startHour >= currentConfig.endHour) {
            alert('Start hour must be before end hour.');
            return;
        }
        onSave(currentConfig);
        onClose();
    };
    
    const handleNumberChange = (field: keyof TodayViewConfig, value: string) => {
        const numValue = parseInt(value, 10);
        if(!isNaN(numValue)) {
            setCurrentConfig(prev => ({ ...prev, [field]: numValue }));
        }
    };
    
    const slotDurations: TodayViewConfig['slotDuration'][] = [15, 45, 60, 120];

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fade-in-fast">
             <style>{`.animate-fade-in-fast { animation: fadeIn 0.15s ease-out forwards; } @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }`}</style>
            <div className="bg-surface dark:bg-surface-dark rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
                <header className="p-4 border-b border-border-light dark:border-border-dark flex justify-between items-center">
                    <h2 className="text-xl font-bold">Today View Settings</h2>
                    <button onClick={onClose} className="p-1 rounded-full text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">
                        <XIcon className="w-6 h-6" />
                    </button>
                </header>
                <main className="flex-1 p-6 space-y-6 overflow-y-auto">
                    <div>
                        <h3 className="text-lg font-semibold mb-2">Working Hours</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="startHour" className="text-sm font-medium">Start Hour</label>
                                <input type="number" id="startHour" min="0" max="23" value={currentConfig.startHour} onChange={e => handleNumberChange('startHour', e.target.value)} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                            </div>
                             <div>
                                <label htmlFor="endHour" className="text-sm font-medium">End Hour</label>
                                <input type="number" id="endHour" min="1" max="24" value={currentConfig.endHour} onChange={e => handleNumberChange('endHour', e.target.value)} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary"/>
                            </div>
                        </div>
                    </div>
                     <div>
                        <h3 className="text-lg font-semibold mb-2">Agenda</h3>
                        <div>
                             <label htmlFor="slotDuration" className="text-sm font-medium">Time Slot Duration (minutes)</label>
                            <select id="slotDuration" value={currentConfig.slotDuration} onChange={e => handleNumberChange('slotDuration', e.target.value)} className="mt-1 w-full p-2 bg-gray-100 dark:bg-gray-800 rounded-md border-transparent focus:ring-primary">
                                {slotDurations.map(dur => (
                                    <option key={dur} value={dur}>{dur}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </main>
                <footer className="p-4 border-t border-border-light dark:border-border-dark flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90">Save Settings</button>
                </footer>
            </div>
        </div>
    );
};
