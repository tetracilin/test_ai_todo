
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TaskProvider, useTasks } from './context/TaskContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Sidebar } from './components/Sidebar';
import { ItemList } from './components/ItemList';
import { ItemDetail } from './components/ItemDetail';
import { ScheduleView } from './components/ScheduleView';
import { MainHeader } from './components/MainHeader';
import { Perspective, Item, ItemType, ItemStatus, WorkPackage, WorkPackageType, Task, Decision, DecisionStatus } from './types';
import { PersonManagementView } from './components/PersonManagementView';
import { usePermissions } from './hooks/usePermissions';
import TeamView from './components/TeamView';
import { ProjectManagementView } from './components/ProjectManagementView';
import { DecisionManagementView } from './components/DecisionManagementView';
import { DecisionTableView } from './components/DecisionTableView';
import { DecisionDetail } from './components/DecisionDetail';
import { LogView } from './components/LogView';
import { TodayView } from './components/TodayView';
import { AdminConfigurationView } from './components/AdminConfigurationView';
import { DataManagementView } from './components/DataManagementView';
import { RoutineManagementView } from './components/RoutineManagementView';
import { InboxView } from './components/InboxView';
import { LoginView } from './components/LoginView';
import { AccountSettingsView } from './components/AccountSettingsView';

const AppContent: React.FC = () => {
    const { getItems, getInbox, upsertItem, deleteItem, getDescendants, getPersons, upsertDecision, deleteDecision } = useTasks();
    const { currentUserId } = useAuth();
    const { getVisibleItemsForUser, canEditItem } = usePermissions();
    
    const [activeView, setActiveView] = useState<string>(Perspective.Inbox);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [isDetailVisible, setIsDetailVisible] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            if (e.matches) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const handleSelectItem = useCallback((id: string) => {
        setSelectedItemId(id);
        setIsDetailVisible(true);
    }, []);

    const handleCloseDetail = () => {
        setSelectedItemId(null);
        setIsDetailVisible(false);
    };

    const handleDeleteItem = (id: string) => {
        if (!currentUserId) return;
        if (activeView === Perspective.DecisionTree || activeView === Perspective.DecisionTable) {
            deleteDecision(id, currentUserId);
            handleCloseDetail();
            return;
        }
        
        const allItems = getItems();
        const item = allItems.find(i => i.id === id);
        if (item && !canEditItem(item, currentUserId, allItems)) {
            alert("You don't have permission to delete this item.");
            return;
        }
        deleteItem(id, currentUserId);
        handleCloseDetail();
    }
    
    const handleSetActiveView = (view: string) => {
        setActiveView(view);
        setSelectedItemId(null);
        setIsDetailVisible(false);
        setIsSidebarOpen(false);
    }

    const { viewTitle, itemsToShow } = useMemo(() => {
        const allItems = getItems();
        
        if (activeView === 'admin/persons') {
            return { viewTitle: 'Person Management', itemsToShow: [] };
        }
        
        if (activeView === 'admin/configuration') {
            return { viewTitle: 'AI Configuration', itemsToShow: [] };
        }

        if (activeView === 'admin/data') {
            return { viewTitle: 'Data Management', itemsToShow: [] };
        }

        if (activeView === Perspective.Projects) {
            return { viewTitle: 'Projects', itemsToShow: [] };
        }
        if (activeView === Perspective.DecisionTable) {
            return { viewTitle: 'Decision Table', itemsToShow: [] };
        }
        if (activeView === Perspective.DecisionTree) {
            return { viewTitle: 'Decision Tree', itemsToShow: [] };
        }
        if (activeView === Perspective.Log) {
            return { viewTitle: 'Activity Log', itemsToShow: [] };
        }
         if (activeView === Perspective.Routines) {
            return { viewTitle: 'Routines', itemsToShow: [] };
        }
        
        if (activeView.startsWith('person/')) {
            const personId = activeView.split('/')[1];
            const person = getPersons().find(p => p.id === personId);
            const viewTitle = person ? `${person.name}'s Items` : 'Team Member';
            const itemsToShow = personId ? getVisibleItemsForUser(personId, allItems) : [];
            return { viewTitle, itemsToShow };
        }

        if (!currentUserId) {
            return { viewTitle: 'Select a User', itemsToShow: [] };
        }

        const userVisibleItems = getVisibleItemsForUser(currentUserId, allItems);
        let viewTitle: string = 'Tasks';
        let itemsToShow: Item[] = [];

        switch (activeView as Perspective) {
            case Perspective.Inbox:
                viewTitle = 'Inbox';
                itemsToShow = []; // Handled by InboxView
                break;
            case Perspective.Today:
                viewTitle = 'Today';
                itemsToShow = []; // Handled by TodayView
                break;
            case Perspective.WorkPackages:
                viewTitle = 'Work Packages';
                itemsToShow = userVisibleItems.filter(i => i.type === ItemType.WorkPackage && i.title !== 'Inbox');
                break;
            case Perspective.Tags:
                viewTitle = 'Tags';
                itemsToShow = userVisibleItems.filter((i): i is Task => i.type === ItemType.Task && i.status === ItemStatus.Active);
                break;
            case Perspective.Flagged:
                viewTitle = 'Flagged';
                itemsToShow = userVisibleItems.filter(i => i.flagged && i.status === ItemStatus.Active);
                break;
            case Perspective.Completed:
                viewTitle = 'Completed';
                itemsToShow = userVisibleItems.filter(i => i.status === ItemStatus.Completed);
                break;
            case Perspective.Schedule:
                viewTitle = 'Schedule';
                itemsToShow = []; // Handled by ScheduleView
                break;
             case Perspective.Team:
                viewTitle = 'Team Overview';
                itemsToShow = []; // Handled by TeamView
                break;
            case Perspective.Accountable: {
                viewTitle = 'Accountable';
                const primaryWpIds = new Set<string>();
                userVisibleItems.forEach(item => {
                    if (item.type === ItemType.WorkPackage && item.accountable === currentUserId && item.title !== 'Inbox') {
                        primaryWpIds.add(item.id);
                    }
                });

                const allRelevantWpIds = new Set(primaryWpIds);
                primaryWpIds.forEach(wpId => {
                    const descendants = getDescendants(wpId);
                    descendants.forEach(descId => {
                        const item = allItems.find(i => i.id === descId);
                        if (item?.type === ItemType.WorkPackage) {
                            allRelevantWpIds.add(item.id);
                        }
                    });
                });
                
                itemsToShow = userVisibleItems.filter(item => {
                    if (item.type === ItemType.WorkPackage) {
                        return allRelevantWpIds.has(item.id);
                    }
                    if (item.type === ItemType.Task) {
                        return item.workPackageId !== null && allRelevantWpIds.has(item.workPackageId);
                    }
                    return false;
                });
                break;
            }
            case Perspective.Responsible: {
                viewTitle = 'Responsible';
                
                const responsibleWpIds = new Set<string>();
                userVisibleItems.forEach(item => {
                    if (item.type === ItemType.WorkPackage && item.responsible.includes(currentUserId) && item.title !== 'Inbox') {
                        responsibleWpIds.add(item.id);
                    }
                });
            
                itemsToShow = userVisibleItems.filter(item => {
                    if (item.type === ItemType.WorkPackage) {
                        return responsibleWpIds.has(item.id);
                    }
                    if (item.type === ItemType.Task) {
                        return item.workPackageId !== null && responsibleWpIds.has(item.workPackageId);
                    }
                    return false;
                });
                break;
            }
            default: // workPackage/:id
                if (activeView.startsWith('workPackage/')) {
                    const workPackageId = activeView.split('/')[1];
                    const workPackage = allItems.find(i => i.id === workPackageId && i.type === ItemType.WorkPackage) as WorkPackage | undefined;
                    viewTitle = workPackage?.title || 'Work Package';
                    if (workPackage) {
                        const descendantIds = getDescendants(workPackageId);
                        const allWorkPackageIds = new Set<string>([workPackageId]);
                        descendantIds.forEach(id => {
                            const item = allItems.find(i => i.id === id);
                            if (item?.type === ItemType.WorkPackage) allWorkPackageIds.add(id);
                        });
                        itemsToShow = userVisibleItems.filter((i): i is Task =>
                            i.type === ItemType.Task &&
                            i.workPackageId !== null &&
                            allWorkPackageIds.has(i.workPackageId)
                        );
                    }
                }
        }
        return { viewTitle, itemsToShow };
    }, [activeView, getItems, getInbox, getDescendants, getPersons, currentUserId, getVisibleItemsForUser]);

    const handleAddItem = useCallback(() => {
        if (!currentUserId) {
            alert("Please select a user to add items.");
            return;
        }
        
        if (activeView === Perspective.DecisionTree) {
            const newDecision: Partial<Decision> & { id: string } = {
                id: crypto.randomUUID(),
                title: 'New Decision',
                projectId: '', 
                parentId: null,
                status: DecisionStatus.ToDo,
            };
            upsertDecision(newDecision, currentUserId);
            handleSelectItem(newDecision.id);
            return;
        }

        let newItem: Omit<WorkPackage, 'createdAt' | 'updatedAt'> | Omit<Task, 'createdAt' | 'updatedAt'>;

        if (activeView === Perspective.WorkPackages || activeView.startsWith("person/")) {
            newItem = {
                id: crypto.randomUUID(),
                creatorId: currentUserId,
                title: 'New Work Package',
                note: '',
                type: ItemType.WorkPackage,
                parentId: null,
                workPackageType: WorkPackageType.Parallel,
                status: ItemStatus.Active,
                flagged: false,
                completedAt: null,
                responsible: [],
                accountable: null,
                consulted: [],
                informed: [],
                projectId: null,
            };
        } else {
            let workPackageId: string | null = null;
            if (activeView.startsWith('workPackage/')) {
                workPackageId = activeView.split('/')[1];
            } else { 
                workPackageId = getInbox()?.id || null;
            }

            newItem = {
                id: crypto.randomUUID(),
                creatorId: currentUserId,
                title: 'New Task',
                note: '',
                type: ItemType.Task,
                workPackageId: workPackageId,
                parentId: null,
                tagIds: [],
                dueDate: null,
                deferDate: null,
                scheduledTime: null,
                estimate: null,
                completedAt: null,
                status: ItemStatus.Active,
                flagged: activeView === Perspective.Flagged,
                isBlocked: false,
                blockageDetails: null,
                timerStartedAt: null,
                accumulatedTime: 0,
                assigneeId: null,
                collaboratorIds: [],
                clarificationNotes: '',
            };
        }
        
        upsertItem(newItem, currentUserId);
        handleSelectItem(newItem.id);

    }, [activeView, getInbox, upsertItem, handleSelectItem, currentUserId, upsertDecision]);
    
    const renderContent = () => {
        switch (activeView) {
            case 'admin/persons':
                return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <PersonManagementView />
                </>;
            case 'admin/configuration':
                return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <AdminConfigurationView />
                </>;
            case 'admin/data':
                return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <DataManagementView />
                </>;
            case Perspective.Log:
                 return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <LogView />
                </>;
            case Perspective.Today:
                return <TodayView onSelectItem={handleSelectItem} onToggleSidebar={() => setIsSidebarOpen(true)} />;
            case Perspective.Routines:
                return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <RoutineManagementView />
                </>;
            case Perspective.Schedule:
                return <ScheduleView onSelectItem={handleSelectItem} selectedItemId={selectedItemId} onToggleSidebar={() => setIsSidebarOpen(true)} />;
            case Perspective.Team:
                return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <TeamView onSelectItem={handleSelectItem} />
                </>;
            case Perspective.Projects:
                 return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <ProjectManagementView />
                </>;
            case Perspective.DecisionTable:
                return <>
                    <MainHeader title={viewTitle} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <DecisionTableView onSelectItem={handleSelectItem} setActiveView={handleSetActiveView} />
                </>;
            case Perspective.DecisionTree:
                return <>
                    <MainHeader title={viewTitle} onAddItem={handleAddItem} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <DecisionManagementView
                        selectedItemId={selectedItemId}
                        onSelectItem={handleSelectItem}
                        onAddItem={handleAddItem}
                        setActiveView={handleSetActiveView}
                    />
                </>;
            case Perspective.Inbox:
                return <InboxView
                    onSelectItem={handleSelectItem}
                    onAddItem={handleAddItem}
                    onToggleSidebar={() => setIsSidebarOpen(true)}
                    onDeleteItem={handleDeleteItem}
                    selectedItemId={selectedItemId}
                />;
            default:
                return <>
                    <MainHeader title={viewTitle} onAddItem={handleAddItem} onToggleSidebar={() => setIsSidebarOpen(true)} />
                    <ItemList 
                        items={itemsToShow} 
                        selectedItemId={selectedItemId} 
                        onSelectItem={handleSelectItem}
                        onDeleteItem={handleDeleteItem}
                        activeView={activeView}
                    />
                </>;
        }
    }

    return (
        <div className="h-screen w-screen flex antialiased text-text-primary dark:text-text-primary-dark overflow-hidden">
             {/* Desktop Sidebar */}
            <div className="hidden md:flex md:flex-shrink-0">
                <Sidebar activeView={activeView} setActiveView={handleSetActiveView} />
            </div>

            {/* Mobile Sidebar */}
            {isSidebarOpen && (
                <div className="md:hidden fixed inset-0 z-40">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setIsSidebarOpen(false)} aria-hidden="true"></div>
                    <div className="relative w-64 h-full">
                        <Sidebar activeView={activeView} setActiveView={handleSetActiveView} />
                    </div>
                </div>
            )}
            
            <main className="flex-1 flex flex-row min-w-0 relative">
                <div className={`w-full h-full flex flex-col transition-transform duration-300 ease-in-out bg-surface/80 dark:bg-surface-dark/80 backdrop-blur-sm md:border-r md:border-border-light md:dark:border-border-dark ${isDetailVisible ? 'hidden md:flex' : 'flex'}`}>
                     {renderContent()}
                </div>

               {isDetailVisible && selectedItemId && (
                    <div className="absolute inset-0 z-20 md:static md:w-1/3 md:flex-shrink-0">
                        {(activeView === Perspective.DecisionTree || activeView === Perspective.DecisionTable) ? (
                            <DecisionDetail
                                itemId={selectedItemId}
                                onClose={handleCloseDetail}
                                onDelete={handleDeleteItem}
                                setActiveView={handleSetActiveView}
                            />
                        ) : (
                            <ItemDetail itemId={selectedItemId} onClose={handleCloseDetail} onDelete={handleDeleteItem} onSelectItem={handleSelectItem} />
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

const FullApp: React.FC = () => {
    const { isReady, currentUserId, appView } = useAuth();
    
    if (!isReady) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-background dark:bg-background-dark">
                <p className="text-text-secondary dark:text-text-secondary-dark">Initializing...</p>
            </div>
        );
    }

    if (!currentUserId) {
        return <LoginView />;
    }
    
    if (appView === 'account-settings') {
        return <AccountSettingsView />;
    }

    return <AppContent />;
}

const App: React.FC = () => {
    return (
        <TaskProvider>
            <AuthProvider>
                <FullApp />
            </AuthProvider>
        </TaskProvider>
    );
};

export default App;
