
import React from 'react';
import { useTasks } from '../context/TaskContext';

export const LogView: React.FC = () => {
    const { getLogs, getPersons } = useTasks();
    const logs = getLogs();
    const persons = getPersons();

    const personMap = React.useMemo(() => {
        return new Map(persons.map(p => [p.id, p.name]));
    }, [persons]);

    const getPersonName = (userId: string) => {
        return personMap.get(userId) || 'Unknown User';
    };

    const formatDate = (isoString: string) => {
        return new Date(isoString).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        });
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="bg-surface dark:bg-surface-dark rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th scope="col" className="px-6 py-3">Timestamp</th>
                            <th scope="col" className="px-6 py-3">User</th>
                            <th scope="col" className="px-6 py-3">Action</th>
                            <th scope="col" className="px-6 py-3">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.length > 0 ? logs.map(log => (
                            <tr key={log.id} className="border-b dark:border-border-dark hover:bg-gray-50 dark:hover:bg-gray-600/20">
                                <td className="px-6 py-4 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark">{formatDate(log.timestamp)}</td>
                                <td className="px-6 py-4 font-medium">{getPersonName(log.userId)}</td>
                                <td className="px-6 py-4">
                                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-200 dark:bg-gray-600 text-text-primary dark:text-text-primary-dark">
                                        {log.action}
                                    </span>
                                </td>
                                <td className="px-6 py-4">{log.details}</td>
                            </tr>
                        )) : (
                           <tr>
                                <td colSpan={4} className="text-center py-10 text-text-secondary dark:text-text-secondary-dark">
                                    No activity logs found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
