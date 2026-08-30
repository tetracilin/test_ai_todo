import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({ api: mockApi }));

import { projectsApi } from "./projects";

describe("projectsApi storage configuration", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.put.mockReset();
    mockApi.get.mockResolvedValue({});
    mockApi.put.mockResolvedValue({});
  });

  it("gets project-scoped storage configuration", async () => {
    await projectsApi.getStorageConfig("project/1");

    expect(mockApi.get).toHaveBeenCalledWith("/projects/project%2F1/storage-config");
  });

  it("gets allowed project-scoped MinIO NAS folders", async () => {
    mockApi.get.mockResolvedValueOnce({ folders: ["/nas/project-1"] });

    await expect(projectsApi.listMinioFolders("project/1")).resolves.toEqual({ folders: ["/nas/project-1"] });

    expect(mockApi.get).toHaveBeenCalledWith("/projects/project%2F1/minio-folders");
  });

  it("saves local and NAS folders using the storage contract", async () => {
    await projectsApi.updateStorageConfig("project/1", {
      repoLocalFolder: "/repo/project-1",
      nasFolder: "/nas/project-1",
    });

    expect(mockApi.put).toHaveBeenCalledWith("/projects/project%2F1/storage-config", {
      repoLocalFolder: "/repo/project-1",
      nasFolder: "/nas/project-1",
    });
  });
});
