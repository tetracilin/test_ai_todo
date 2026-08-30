// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project } from "@paperclipai/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStorageConfig } from "./ProjectStorageConfig";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  getStorageConfig: vi.fn(),
  listMinioFolders: vi.fn(),
  updateStorageConfig: vi.fn(),
}));

vi.mock("../api/projects", () => ({ projectsApi: api }));

const project = { id: "project-1" } as Project;
let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <ProjectStorageConfig project={project} />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  api.getStorageConfig.mockResolvedValue({
    projectId: "project-1",
    repoLocalFolder: "/repo/project-1",
    minio: {
      enabled: true,
      consoleUrl: "https://minio.example.test",
      bucket: "paperclip-artifacts",
      nasFolder: "/projects/old",
    },
  });
  api.listMinioFolders.mockResolvedValue({ folders: ["/projects/old", "/projects/new"] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ProjectStorageConfig", () => {
  it("loads current storage, saves a selected NAS folder, and renders saved response", async () => {
    api.updateStorageConfig.mockResolvedValue({
      projectId: "project-1",
      repoLocalFolder: "/repo/project-1",
      minio: {
        enabled: true,
        consoleUrl: "https://minio.example.test",
        bucket: "paperclip-artifacts",
        nasFolder: "/projects/new",
      },
    });

    render();
    await waitFor(() => expect(container.querySelector<HTMLSelectElement>("#project-minio-nas-folder")).not.toBeNull());

    const folderSelect = container.querySelector<HTMLSelectElement>("#project-minio-nas-folder")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(folderSelect, "/projects/new");
      folderSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());

    await waitFor(() => expect(api.updateStorageConfig).toHaveBeenCalledWith("project-1", {
      repoLocalFolder: "/repo/project-1",
      nasFolder: "/projects/new",
    }));
    await waitFor(() => expect(folderSelect.value).toBe("/projects/new"));
    expect(container.textContent).toContain("REPO LOCAL FOLDER");
    expect(container.textContent).not.toContain("accessKey");
    expect(container.textContent).not.toContain("secretKey");
  });

  it("renders allowed-folder failures without exposing configuration values", async () => {
    api.listMinioFolders.mockRejectedValue(new Error("MinIO NAS is unavailable"));

    render();
    await waitFor(() => expect(container.textContent).toContain("MinIO NAS is unavailable"));
    expect(container.querySelector("#project-minio-nas-folder")).toBeNull();
    expect(container.textContent).not.toContain("secret");
  });
});
