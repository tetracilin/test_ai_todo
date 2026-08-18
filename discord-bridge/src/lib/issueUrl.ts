export function issueUrl(identifier: string, prefix: string, dashboardUrl: string): string {
  return `${dashboardUrl}/${prefix}/issues/${identifier}`;
}
