export const STORY_MAP_STORY_STATUSES = ["planned", "in_progress", "done"] as const;
export type StoryMapStoryStatus = (typeof STORY_MAP_STORY_STATUSES)[number];

export const SCRATCH_NOTE_STATUSES = ["active", "promoted", "archived"] as const;
export type ScratchNoteStatus = (typeof SCRATCH_NOTE_STATUSES)[number];

/** Maximum length of a scratch pad note, in characters (AD-106). */
export const SCRATCH_NOTE_MAX_LENGTH = 2000;

export interface StoryMap {
  id: string;
  companyId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryMapActivity {
  id: string;
  companyId: string;
  mapId: string;
  name: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryMapTask {
  id: string;
  companyId: string;
  mapId: string;
  activityId: string;
  name: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryMapRelease {
  id: string;
  companyId: string;
  mapId: string;
  name: string;
  /** Calendar date as YYYY-MM-DD, or null when no target date is set. */
  targetDate: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryMapEpic {
  id: string;
  companyId: string;
  mapId: string;
  taskId: string;
  name: string;
  description: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryMapStory {
  id: string;
  companyId: string;
  mapId: string;
  taskId: string;
  epicId: string | null;
  /** Null means the story sits in the "Unscheduled" row. */
  releaseId: string | null;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  size: string | null;
  status: StoryMapStoryStatus;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The whole map of a company. `map` is null until the first item is created. */
export interface StoryMapTree {
  map: StoryMap | null;
  activities: StoryMapActivity[];
  tasks: StoryMapTask[];
  releases: StoryMapRelease[];
  epics: StoryMapEpic[];
  stories: StoryMapStory[];
}

export interface ScratchNote {
  id: string;
  companyId: string;
  authorUserId: string;
  body: string;
  status: ScratchNoteStatus;
  promotedStoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStoryMapActivityRequest { name: string; position?: number | null }
export interface UpdateStoryMapActivityRequest { name?: string; position?: number }
export interface CreateStoryMapTaskRequest { activityId: string; name: string; position?: number | null }
export interface UpdateStoryMapTaskRequest { name?: string; position?: number }
export interface CreateStoryMapReleaseRequest { name: string; targetDate?: string | null; position?: number | null }
export interface UpdateStoryMapReleaseRequest { name?: string; targetDate?: string | null; position?: number }
export interface CreateStoryMapEpicRequest {
  taskId: string;
  name: string;
  description?: string | null;
  position?: number | null;
}
export interface UpdateStoryMapEpicRequest { name?: string; description?: string | null; position?: number }
export interface CreateStoryMapStoryRequest {
  taskId: string;
  epicId?: string | null;
  releaseId?: string | null;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  size?: string | null;
  status?: StoryMapStoryStatus;
  position?: number | null;
}
export interface UpdateStoryMapStoryRequest {
  epicId?: string | null;
  releaseId?: string | null;
  title?: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  size?: string | null;
  status?: StoryMapStoryStatus;
  position?: number;
}
export interface CreateScratchNoteRequest { body: string }
export interface UpdateScratchNoteRequest { body: string }
