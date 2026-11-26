import type {
  CreateStoryMapActivityRequest,
  CreateStoryMapEpicRequest,
  CreateStoryMapReleaseRequest,
  CreateStoryMapStoryRequest,
  CreateStoryMapTaskRequest,
  StoryMapActivity,
  StoryMapEpic,
  StoryMapRelease,
  StoryMapStory,
  StoryMapTask,
  StoryMapTree,
  UpdateStoryMapActivityRequest,
  UpdateStoryMapEpicRequest,
  UpdateStoryMapReleaseRequest,
  UpdateStoryMapStoryRequest,
  UpdateStoryMapTaskRequest,
} from "@paperclipai/shared";
import { api } from "./client";

function base(companyId: string) {
  return `/companies/${encodeURIComponent(companyId)}/story-map`;
}

function item(companyId: string, kind: string, id: string) {
  return `${base(companyId)}/${kind}/${encodeURIComponent(id)}`;
}

export const storyMapApi = {
  get: (companyId: string) => api.get<StoryMapTree>(base(companyId)),

  createActivity: (companyId: string, payload: CreateStoryMapActivityRequest) =>
    api.post<StoryMapActivity>(`${base(companyId)}/activities`, payload),
  updateActivity: (companyId: string, id: string, payload: UpdateStoryMapActivityRequest) =>
    api.patch<StoryMapActivity>(item(companyId, "activities", id), payload),

  createTask: (companyId: string, payload: CreateStoryMapTaskRequest) =>
    api.post<StoryMapTask>(`${base(companyId)}/tasks`, payload),
  updateTask: (companyId: string, id: string, payload: UpdateStoryMapTaskRequest) =>
    api.patch<StoryMapTask>(item(companyId, "tasks", id), payload),

  createRelease: (companyId: string, payload: CreateStoryMapReleaseRequest) =>
    api.post<StoryMapRelease>(`${base(companyId)}/releases`, payload),
  updateRelease: (companyId: string, id: string, payload: UpdateStoryMapReleaseRequest) =>
    api.patch<StoryMapRelease>(item(companyId, "releases", id), payload),

  createEpic: (companyId: string, payload: CreateStoryMapEpicRequest) =>
    api.post<StoryMapEpic>(`${base(companyId)}/epics`, payload),
  updateEpic: (companyId: string, id: string, payload: UpdateStoryMapEpicRequest) =>
    api.patch<StoryMapEpic>(item(companyId, "epics", id), payload),

  createStory: (companyId: string, payload: CreateStoryMapStoryRequest) =>
    api.post<StoryMapStory>(`${base(companyId)}/stories`, payload),
  updateStory: (companyId: string, id: string, payload: UpdateStoryMapStoryRequest) =>
    api.patch<StoryMapStory>(item(companyId, "stories", id), payload),
};
