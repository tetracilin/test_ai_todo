import type {
  CreateScratchNoteRequest,
  PromoteScratchNoteResult,
  ScratchNote,
  ScratchNoteList,
  UpdateScratchNoteRequest,
} from "@paperclipai/shared";
import { api } from "./client";

function base(companyId: string) {
  return `/companies/${encodeURIComponent(companyId)}/scratch-notes`;
}

function note(companyId: string, noteId: string) {
  return `${base(companyId)}/${encodeURIComponent(noteId)}`;
}

export const scratchPadApi = {
  list: (companyId: string) => api.get<ScratchNoteList>(base(companyId)),
  create: (companyId: string, payload: CreateScratchNoteRequest) => api.post<ScratchNote>(base(companyId), payload),
  update: (companyId: string, noteId: string, payload: UpdateScratchNoteRequest) =>
    api.patch<ScratchNote>(note(companyId, noteId), payload),
  remove: (companyId: string, noteId: string) => api.delete<{ ok: true }>(note(companyId, noteId)),
  /** Owners and admins only. */
  promote: (companyId: string, noteId: string) =>
    api.post<PromoteScratchNoteResult>(`${note(companyId, noteId)}/promote`, {}),
  /** Owners and admins only. */
  archive: (companyId: string, noteId: string) => api.post<ScratchNote>(`${note(companyId, noteId)}/archive`, {}),
};
