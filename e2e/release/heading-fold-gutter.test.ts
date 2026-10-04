import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startReleaseServer } from "../fixtures/release.ts";

test("heading-only controls in the embedded release frontend", async ({
  page,
}) => {
  const server = await startReleaseServer();
  const text =
    "# Heading\n\nSection text\n\n## Child heading\n\nChild text\n\n# Next heading\n\n- Parent\n  - Child one\n  - Child two\n- Sibling\n";
  const pagePath = join(server.spaceDir, "FoldTest.md");
  try {
    await writeFile(pagePath, text);
    await page.goto(`${server.url}/FoldTest?headless=1`);
    const editor = page.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("Section text");
    const controls = page.locator('.cm-foldGutter [title="Fold line"]');
    // Three headings, not the nested-list parent.
    await expect(controls).toHaveCount(3);
    const open = controls.first();
    const triangle = await open.boundingBox();
    const heading = await page.locator(".sb-line-h1").first().boundingBox();
    expect(
      Math.abs(
        triangle!.y + triangle!.height / 2 - (heading!.y + heading!.height / 2),
      ),
    ).toBeLessThan(1.5);
    await open.click();
    await expect(editor).not.toContainText("Section text");
    await expect(editor).toContainText("Next heading");
    const closed = page
      .locator('.cm-foldGutter [title="Unfold line"]:visible')
      .first();
    await expect(closed).toHaveText("▶");
    await closed.click();
    await expect(editor).toContainText("Child text");
    await expect(editor).toContainText("Child one");
    await expect(controls).toHaveCount(3);
    await page.screenshot({ path: "heading-expanded.png" });
    const response = await page.request.get(`${server.url}/.fs/FoldTest.md`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe(text);
    expect(await readFile(pagePath, "utf8")).toBe(text);
  } finally {
    await server.stop();
  }
});
