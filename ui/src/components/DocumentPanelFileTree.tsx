import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { artifactsApi, type CompanyArtifact } from "../api/artifacts";
import { queryKeys } from "../lib/queryKeys";
import { FileTree, buildFileTree } from "./FileTree";

export interface DocumentPanelFileTreeProps {
  companyId: string | null | undefined;
  projectId: string | null | undefined;
  selectedArtifactId: string | null;
  onOpenArtifact: (artifact: CompanyArtifact) => void;
}

/** Group artifacts into one folder per task, keyed by a unique tree path. */
export function artifactTreePaths(artifacts: CompanyArtifact[]): Map<string, CompanyArtifact> {
  const byPath = new Map<string, CompanyArtifact>();
  for (const artifact of artifacts) {
    const folder = (artifact.issue.identifier || artifact.issue.title || "Task").replace(/\//g, "-");
    const name = (artifact.title || artifact.id).replace(/\//g, "-");
    let path = `${folder}/${name}`;
    if (byPath.has(path)) path = `${folder}/${name} (${artifact.id.slice(0, 8)})`;
    byPath.set(path, artifact);
  }
  return byPath;
}

/** Read-only tree of the artifacts of a project, listed through the company artifacts API. */
export function DocumentPanelFileTree({
  companyId,
  projectId,
  selectedArtifactId,
  onOpenArtifact,
}: DocumentPanelFileTreeProps) {
  const enabled = Boolean(companyId && projectId);
  const query = useQuery({
    queryKey: [...queryKeys.artifacts.list(companyId ?? "", "all"), "project", projectId ?? ""],
    queryFn: () => artifactsApi.list(companyId!, { projectId: projectId!, limit: 200 }),
    enabled,
  });
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const byPath = useMemo(() => artifactTreePaths(query.data?.artifacts ?? []), [query.data]);
  const nodes = useMemo(
    () => buildFileTree(Object.fromEntries([...byPath.keys()].map((path) => [path, true]))),
    [byPath],
  );
  const selectedFile = useMemo(() => {
    for (const [path, artifact] of byPath) if (artifact.id === selectedArtifactId) return path;
    return null;
  }, [byPath, selectedArtifactId]);

  function toggleDir(path: string) {
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <FileTree
      ariaLabel="Project artifacts"
      nodes={nodes}
      selectedFile={selectedFile}
      expandedDirs={expandedDirs}
      showCheckboxes={false}
      loading={enabled && query.isLoading}
      error={query.isError ? { message: "Could not load the project files.", retry: () => void query.refetch() } : null}
      empty={{ title: "No artifacts", description: "This project has no artifacts yet." }}
      onToggleDir={toggleDir}
      onSelectFile={(path) => {
        const artifact = byPath.get(path);
        if (artifact) onOpenArtifact(artifact);
      }}
    />
  );
}
