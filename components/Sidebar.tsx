
import React, { useState } from 'react';
import { Perspective, ItemType } from '../types';
import { PERSONAL_PERSPECTIVES_ORDER, PROJECT_MANAGEMENT_PERSPECTIVES_ORDER } from '../constants';
import { useTasks } from '../context/TaskContext';
import { InboxIcon } from './icons/InboxIcon';
import { WorkPackageIcon } from './icons/ProjectIcon';
import { TagIcon } from './icons/TagIcon';
import { CalendarIcon } from './icons/CalendarIcon';
import { FlagIcon } from './icons/FlagIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { UsersIcon } from './icons/UsersIcon';
import { UserIcon } from './icons/UserIcon';
import { UserMenu } from './UserMenu';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { BriefcaseIcon } from './icons/BriefcaseIcon';
import { GitBranchIcon } from './icons/GitBranchIcon';
import { FileTextIcon } from './icons/FileTextIcon';
import { TableIcon } from './icons/TableIcon';
import { ClockIcon } from './icons/ClockIcon';
import { SettingsIcon } from './icons/SettingsIcon';
import { DatabaseIcon } from './icons/DatabaseIcon';
import { RepeatIcon } from './icons/RepeatIcon';

interface SidebarProps {
  activeView: string; // Can be a Perspective or a work package/tag ID
  setActiveView: (view: string) => void;
}

const perspectiveIcons: Record<string, React.ReactNode> = {
  [Perspective.Inbox]: <InboxIcon className="w-5 h-5" />,
  [Perspective.Today]: <ClockIcon className="w-5 h-5" />,
  [Perspective.Routines]: <RepeatIcon className="w-5 h-5" />,
  [Perspective.WorkPackages]: <WorkPackageIcon className="w-5 h-5" />,
  [Perspective.Tags]: <TagIcon className="w-5 h-5" />,
  [Perspective.Schedule]: <CalendarIcon className="w-5 h-5" />,
  [Perspective.Flagged]: <FlagIcon className="w-5 h-5" />,
  [Perspective.Completed]: <CheckCircleIcon className="w-5 h-5" />,
  [Perspective.Accountable]: <ShieldCheckIcon className="w-5 h-5" />,
  [Perspective.Responsible]: <UsersIcon className="w-5 h-5" />,
  [Perspective.Projects]: <BriefcaseIcon className="w-5 h-5" />,
  [Perspective.DecisionTable]: <TableIcon className="w-5 h-5" />,
  [Perspective.DecisionTree]: <GitBranchIcon className="w-5 h-5" />,
  [Perspective.Log]: <FileTextIcon className="w-5 h-5" />,
};

const perspectiveLabels: Record<string, string> = {
    [Perspective.Inbox]: 'Inbox',
    [Perspective.Today]: 'Today',
    [Perspective.Routines]: 'Routines',
    [Perspective.WorkPackages]: 'Work Packages',
    [Perspective.Tags]: 'Tags',
    [Perspective.Schedule]: 'Schedule',
    [Perspective.Flagged]: 'Flagged',
    [Perspective.Completed]: 'Completed',
    [Perspective.Accountable]: 'Accountable',
    [Perspective.Responsible]: 'Responsible',
    [Perspective.Team]: 'Team',
    [Perspective.Projects]: 'Projects',
    [Perspective.DecisionTable]: 'Decision Table',
    [Perspective.DecisionTree]: 'Decision Tree',
    [Perspective.Log]: 'Log',
};

export const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView }) => {
  const { getItems, getPersons } = useTasks();
  const workPackages = getItems().filter(item => item.type === ItemType.WorkPackage && item.title !== 'Inbox');
  const persons = getPersons();
  const [isTeamSectionOpen, setIsTeamSectionOpen] = useState(true);

  const NavItem = ({ view, label, icon, isSubItem = false }: { view: string; label: string; icon: React.ReactNode; isSubItem?: boolean }) => (
    <button
      onClick={() => setActiveView(view)}
      className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-150 ${
        activeView === view
          ? 'bg-primary/10 text-primary dark:bg-primary/20'
          : 'text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
      } ${isSubItem ? 'pl-10' : 'pl-3'}`}
    >
      <span className="mr-3">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <aside className="w-64 h-full bg-surface dark:bg-surface-dark border-r border-border-light dark:border-border-dark flex flex-col p-2 space-y-1">
      <div className="px-1 mb-2">
        <UserMenu />
      </div>
      <nav className="flex-1 overflow-y-auto overscroll-contain">
        <h3 className="px-3 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider mb-2">Personal</h3>
        {PERSONAL_PERSPECTIVES_ORDER.map(p => (
          <NavItem key={p} view={p} label={perspectiveLabels[p] || p} icon={perspectiveIcons[p]} />
        ))}
        
        <div className="mt-4 pt-4 border-t border-border-light dark:border-border-dark">
            <h3 className="px-3 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider mb-2">Project Management</h3>
            {PROJECT_MANAGEMENT_PERSPECTIVES_ORDER.map(p => (
                <NavItem key={p} view={p} label={perspectiveLabels[p] || p} icon={perspectiveIcons[p]} />
            ))}
        </div>

        {persons.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border-light dark:border-border-dark">
              <button 
                onClick={() => setIsTeamSectionOpen(!isTeamSectionOpen)}
                className="w-full flex justify-between items-center px-3 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider mb-2 hover:text-text-primary dark:hover:text-text-primary-dark focus:outline-none transition-colors"
              >
                <span>Team</span>
                <ChevronDownIcon className={`w-5 h-5 transition-transform duration-200 ${isTeamSectionOpen ? '' : '-rotate-90'}`} />
              </button>
              
              <NavItem key="team-overview" view={Perspective.Team} label="Overview" icon={<UsersIcon className="w-5 h-5"/>} />
              
              {isTeamSectionOpen && (
                <div className="pl-3">
                  {persons.map(person => (
                    <NavItem key={person.id} view={`person/${person.id}`} label={person.name} icon={<UserIcon className="w-4 h-4 text-secondary dark:text-text-secondary-dark"/>} isSubItem />
                  ))}
                </div>
              )}
            </div>
        )}

        {workPackages.length > 0 && <div className="mt-4 pt-4 border-t border-border-light dark:border-border-dark">
          <h3 className="px-3 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider mb-2">Work Packages</h3>
          {workPackages.map(wp => (
            <NavItem key={wp.id} view={`workPackage/${wp.id}`} label={wp.title} icon={<WorkPackageIcon className="w-4 h-4 text-secondary dark:text-text-secondary-dark"/>} isSubItem />
          ))}
        </div>}
        
        <div className="mt-4 pt-4 border-t border-border-light dark:border-border-dark">
          <h3 className="px-3 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider mb-2">Admin</h3>
            <NavItem 
              key="admin-persons" 
              view="admin/persons" 
              label="Persons" 
              icon={<UsersIcon className="w-5 h-5"/>} 
            />
            <NavItem
              key="admin-config"
              view="admin/configuration"
              label="Configuration"
              icon={<SettingsIcon className="w-5 h-5" />}
            />
             <NavItem
              key="admin-data"
              view="admin/data"
              label="Import/Export"
              icon={<DatabaseIcon className="w-5 h-5" />}
            />
            <NavItem 
              key="admin-log" 
              view={Perspective.Log} 
              label="Log" 
              icon={perspectiveIcons[Perspective.Log]} 
            />
        </div>
      </nav>
    </aside>
  );
};
