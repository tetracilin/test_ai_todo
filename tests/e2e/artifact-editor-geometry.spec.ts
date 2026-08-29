import { expect, test, type APIRequestContext } from "@playwright/test";

type Seed = {
  companyId: string;
  prefix: string;
  issueId: string;
};

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  const text = await response.text();
  expect(response.ok(), `${response.url()} failed ${response.status()}: ${text}`).toBe(true);
  return JSON.parse(text) as Record<string, string>;
}

async function createArtifactEditorSeed(request: APIRequestContext): Promise<Seed> {
  const company = await expectOk(await request.post("/api/companies", {
    data: { name: `Artifact editor geometry ${Date.now()}` },
  }));
  const issue = await expectOk(await request.post(`/api/companies/${company.id}/issues`, {
    data: { title: "Verify artifact editor geometry", status: "todo" },
  }));
  await expectOk(await request.post(`/api/companies/${company.id}/issues/${issue.id}/artifacts`, {
    multipart: {
      issueId: issue.id,
      file: {
        name: "geometry.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: Buffer.from("DOCX fixture"),
      },
    },
  }));
  return {
    companyId: company.id,
    prefix: company.issuePrefix ?? company.prefix ?? company.urlKey ?? "E2E",
    issueId: issue.id,
  };
}

test("artifact OpenOffice editor keeps a 1200x800 primary DOM area at 1700x1100", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1100 });
  const seed = await createArtifactEditorSeed(page.request);

  await page.goto(`/${seed.prefix}/issues/${seed.issueId}`);
  const artifactRow = page.getByText("geometry.docx", { exact: true }).locator("xpath=../..");
  await expect(artifactRow).toBeVisible({ timeout: 30_000 });
  await artifactRow.getByRole("button", { name: "Open editor" }).click();
  await page.getByRole("textbox", { name: "Version name for OpenOffice save" }).fill("Geometry verification");
  await page.getByRole("button", { name: "Edit with OpenOffice" }).click();

  const dialog = page.getByRole("dialog");
  const primary = page.getByTestId("artifact-editor-primary");
  const iframe = page.getByTestId("artifact-editor-frame");
  await expect(iframe).toBeVisible({ timeout: 20_000 });

  const [dialogBox, primaryBox, iframeBox] = await Promise.all([
    dialog.boundingBox(),
    primary.boundingBox(),
    iframe.boundingBox(),
  ]);
  expect(dialogBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  expect(iframeBox).not.toBeNull();
  expect(primaryBox!.width).toBeGreaterThanOrEqual(1200);
  expect(primaryBox!.height).toBeGreaterThanOrEqual(800);
  expect(iframeBox!.width).toBeGreaterThanOrEqual(1200);
  expect(iframeBox!.height).toBeGreaterThanOrEqual(700);
});
