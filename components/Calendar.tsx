
import React from 'react';
import { ChevronLeftIcon } from './icons/ChevronLeftIcon';
import { ChevronRightIcon } from './icons/ChevronRightIcon';

// --- Date Helpers ---
const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
const isSameDay = (d1: Date, d2: Date) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
const toISODateString = (date: Date) => date.toISOString().split('T')[0];
const getMonthName = (monthIndex: number) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][monthIndex];

interface CalendarProps {
    rangeStartDate: Date;
    dayCount: number;
    selectedDate: Date;
    tasksByDate: Map<string, any[]>;
    onDateSelect: (date: Date) => void;
    onDropOnDate: (date: Date, taskId: string) => void;
    onNavigate: (direction: 'prev' | 'next') => void;
}

export const Calendar: React.FC<CalendarProps> = ({ rangeStartDate, dayCount, selectedDate, tasksByDate, onDateSelect, onDropOnDate, onNavigate }) => {
    const [dragOverDate, setDragOverDate] = React.useState<Date | null>(null);

    const dates = React.useMemo(() => {
        return Array.from({ length: dayCount }, (_, i) => addDays(rangeStartDate, i));
    }, [rangeStartDate, dayCount]);

    const handleDrop = (e: React.DragEvent, date: Date) => {
        e.preventDefault();
        setDragOverDate(null);
        const taskData = e.dataTransfer.getData('application/json');
        if (taskData) {
            const parsed = JSON.parse(taskData);
            if (parsed.id) {
                onDropOnDate(date, parsed.id);
            }
        }
    }
    
    const rangeEndDate = dates[dates.length - 1];

    return (
        <div className="p-4 border-b border-border-light dark:border-border-dark">
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => onNavigate('prev')} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                    <ChevronLeftIcon className="w-5 h-5" />
                </button>
                <h2 className="text-base md:text-lg font-semibold text-text-primary dark:text-text-primary-dark text-center">
                    {getMonthName(rangeStartDate.getMonth())} {rangeStartDate.getDate()} - {getMonthName(rangeEndDate.getMonth())} {rangeEndDate.getDate()}, {rangeEndDate.getFullYear()}
                </h2>
                <button onClick={() => onNavigate('next')} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                    <ChevronRightIcon className="w-5 h-5" />
                </button>
            </div>
            <div className="grid gap-1 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(45px, 1fr))` }}>
                {dates.map((date, i) => {
                    const isSelected = isSameDay(date, selectedDate);
                    const isToday = isSameDay(date, new Date());
                    const isoDate = toISODateString(date);
                    const hasTasks = tasksByDate.has(isoDate) && tasksByDate.get(isoDate)!.length > 0;
                    const isDragOver = dragOverDate && isSameDay(date, dragOverDate);

                    return (
                        <div key={i}
                             onDrop={(e) => handleDrop(e, date)}
                             onDragOver={(e) => { e.preventDefault(); setDragOverDate(date); }}
                             onDragLeave={() => setDragOverDate(null)}
                             onClick={() => onDateSelect(date)}
                             className={`relative text-center p-2 rounded-lg cursor-pointer transition-all duration-150
                                ${isDragOver ? 'outline outline-2 outline-primary outline-offset-[-2px]' : ''}
                                ${isSelected ? 'bg-primary text-white shadow-lg' : ''}
                                ${!isSelected && isToday ? 'bg-gray-200 dark:bg-gray-700' : ''}
                                ${!isSelected && !isToday ? 'hover:bg-gray-100 dark:hover:bg-gray-800' : ''}
                             `}
                        >
                            <div className={`text-xs uppercase ${isSelected ? 'text-white/80' : 'text-text-secondary dark:text-text-secondary-dark'}`}>{date.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                            <div className={`font-bold text-lg ${isSelected ? 'text-white' : ''}`}>{date.getDate()}</div>
                            {hasTasks && <div className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-primary'}`}></div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
