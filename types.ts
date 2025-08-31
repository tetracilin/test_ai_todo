
export enum ItemStatus {
  Active = 'Active',
  Completed = 'Completed',
  Dropped = 'Dropped',
  OnGoing = 'On-going',
  Blocked = 'Blocked',
}

export enum ItemType {
  WorkPackage = 'WorkPackage',
  Task = 'Task',
}

export enum WorkPackageType {
    Sequential = 'Sequential',
    Parallel = 'Parallel',
    SingleActionList = 'SingleActionList',
}

export enum PhaseType {
    Proposal = 'Proposal',
    Concept = 'Concept',
    Feasibility = 'Feasibility',
    Design = 'Design',
    Development = 'Development',
    Release = 'Release',
    Repeat = 'Repeat',
    HighVolume = 'High-Volume'
}

export interface Tag {
  id: string;
  name: string;
}

export interface SecurityQuestion {
    question: string;
    answerHash: string;
}

export interface Person {
  id:string;
  name: string;
  email: string;
  mobile: string;
  avatarUrl?: string; // Optional avatar
  aiPrompt?: string; // Custom prompt for AI interactions
  passwordHash?: string; // Hashed password for email/password auth
  securityQuestions?: SecurityQuestion[];
}

export interface BaseItem {
  id: string;
  creatorId: string;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  flagged: boolean;
}

export interface Attachment {
    id: string;
    fileName: string;
    mimeType: string;
    data: string; // base64 encoded data url
}

export interface BlockageDetails {
    reporterId: string;
    assigneeId: string;
    details: string;
    createdAt: string;
    attachments: Attachment[];
}

export interface Task extends BaseItem {
  type: ItemType.Task;
  workPackageId: string | null; // null for inbox tasks
  parentId?: string | null; // For subtasks
  tagIds: string[];
  dueDate: string | null;
  deferDate: string | null;
  scheduledTime: string | null;
  estimate: number | null; // Duration in minutes
  completedAt: string | null;
  status: ItemStatus;
  dodId?: string | null; // Link to the Definition of Done it came from
  isBlocked: boolean;
  blockageDetails: BlockageDetails | null;
  timerStartedAt: string | null;
  accumulatedTime: number; // in seconds
  assigneeId?: string | null; // The person assigned to do the task
  collaboratorIds?: string[]; // People collaborating on the task
  clarificationNotes?: string;
  routineId?: string | null;
}

export interface Requirement {
  id: string;
  text: string;
  completed: boolean;
}

export interface DefinitionOfDone {
  id: string;
  text: string;
  assigneeId: string;
  requirements: Requirement[];
  workPackageId: string | null;
}

export interface WorkPackage extends BaseItem {
  type: ItemType.WorkPackage;
  parentId?: string | null; // For nested work packages
  workPackageType: WorkPackageType;
  status: ItemStatus; // WorkPackages can also be completed or dropped
  completedAt: string | null;
  // RACI Matrix
  responsible: string[]; // Person IDs
  accountable: string | null; // Person ID
  consulted: string[]; // Person IDs
  informed: string[]; // Person IDs
  plannedDeadline?: string | null;
  definitionsOfDone?: DefinitionOfDone[];
  projectId: string | null;
}

export type Item = Task | WorkPackage;

export interface Milestone {
    id: string;
    name: string;
    plannedStartDate: string | null;
    plannedFinishDate: string | null;
    actualStartDate: string | null;
    actualFinishDate: string | null;
}

export interface Phase {
    id: string;
    type: PhaseType;
    milestones: Milestone[];
}

export interface Project {
    id: string;
    creatorId: string;
    name: string;
    code: string;
    contractId: string;
    status: string;
    phases: Phase[];
    createdAt: string;
    updatedAt: string;
}

export interface KnowledgeGap {
    id: string;
    title: string;
    assigneeId: string;
    decisionId: string;
    convertedToWpId: string | null;
}

export enum DecisionStatus {
    ToDo = 'ToDo',
    OnGoing = 'On-going',
    Pending = 'Pending',
    Done = 'Done',
    Closed = 'Closed',
}

export interface Decision {
    id: string;
    creatorId: string;
    title: string;
    projectId: string;
    parentId: string | null;
    knowledgeGaps: KnowledgeGap[];
    convertedToWpId: string | null;
    createdAt: string;
    updatedAt: string;
    status: DecisionStatus;
    plannedStartDate: string | null;
    plannedFinishDate: string | null;
    actualStartDate: string | null;
    actualFinishDate: string | null;
}

export enum LogAction {
    CREATE = 'CREATE',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE',
    LOGIN = 'LOGIN',
    GENERATE = 'GENERATE',
    CONVERT = 'CONVERT',
    CLARIFY = 'CLARIFY',
    BLOCK = 'BLOCK',
    IMPORT = 'IMPORT',
    ROUTINE_GENERATE = 'ROUTINE_GENERATE',
}

export interface LogEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: LogAction;
  details: string;
  targetId?: string; // ID of the item, project, person etc.
  targetType?: string; // 'Task', 'WorkPackage', 'Person', etc.
}

export interface TodayViewConfig {
    startHour: number; // 0-23
    endHour: number;   // 1-24
    slotDuration: 15 | 45 | 60 | 120;
}

export interface LeaveBlock {
    id: string;
    date: string; // YYYY-MM-DD
    title: string;
    startTime: string; // HH:mm
    endTime: string;   // HH:mm
    creatorId: string;
}

export interface AiConfig {
  taskGenerationMasterPrompt: string;
  workPackageSubtaskGenerationMasterPrompt: string;
  blockerTags?: string[];
}

export enum RecurrenceFrequency {
    Daily = 'Daily',
    Weekly = 'Weekly',
}

export interface RecurrenceRule {
    frequency: RecurrenceFrequency;
    daysOfWeek?: number[]; // 0 for Sunday, 6 for Saturday. Only for 'Weekly'.
}

export interface Routine {
    id: string;
    creatorId: string;
    title: string;
    note: string;
    tagIds: string[];
    estimate: number | null;
    assigneeId: string | null;
    recurrenceRule: RecurrenceRule;
    createdAt: string;
    updatedAt: string;
    lastGeneratedForDate?: string;
}

export interface InboxFeedFilter {
    assignments: boolean;
    collaborations: boolean;
    subtaskEvents: boolean;
}

export type AppData = {
  items: Item[];
  tags: Tag[];
  persons: Person[];
  projects: Project[];
  decisions: Decision[];
  routines: Routine[];
  logs: LogEntry[];
  todayViewTagIds?: string[];
  todayViewConfig: TodayViewConfig;
  leaveBlocks: LeaveBlock[];
  aiConfig?: AiConfig;
  inboxFeedFilter: InboxFeedFilter;
  dismissedFeedItemIds: string[];
};

export enum Perspective {
    Inbox = 'Inbox',
    Today = 'Today',
    Routines = 'Routines',
    WorkPackages = 'WorkPackages',
    Tags = 'Tags',
    Schedule = 'Schedule',
    Flagged = 'Flagged',
    Completed = 'Completed',
    Accountable = 'Accountable',
    Responsible = 'Responsible',
    Team = 'Team',
    Projects = 'Projects',
    DecisionTable = 'DecisionTable',
    DecisionTree = 'DecisionTree',
    Log = 'Log',
}
