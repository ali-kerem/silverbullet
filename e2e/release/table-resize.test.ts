import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { startReleaseServer } from "../fixtures/release.ts";

const tableText =
  "| Name | Description | Score |\n|---|---|---|\n| Alpha | A longer description that wraps when this column is made narrower. | 42 |\n| Beta | Another description with **bold** text. | 7 |";
const text = `# Tables\n\nBefore.\n\n${tableText}\n\nBetween.\n\n${tableText}\n\nAfter.\n`;
const widgets = (page: Page) => page.locator(".sb-table-widget");
const widths = (widget: Locator) =>
  widget
    .locator("th")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().width),
    );

async function ready(page: Page, url: string) {
  await page.goto(`${url}/TableTest?headless=1`);
  await expect(widgets(page)).toHaveCount(2);
  await expect(
    widgets(page).first().locator(".sb-table-column-handle"),
  ).toHaveCount(2);
  await expect(
    widgets(page).first().locator(".sb-table-column-handle").first(),
  ).toHaveAttribute("aria-valuenow", /\d+/);
}

async function drag(page: Page, widget: Locator, index: number, delta: number) {
  const handle = widget.locator(".sb-table-column-handle").nth(index);
  const rect = (await handle.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 16);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + delta, rect.y + 16, {
    steps: 8,
  });
  await page.mouse.up();
}

async function savedWidths(page: Page, occurrence = 0) {
  return page.evaluate(
    (n) =>
      (globalThis as any).client.ds.get([
        "client",
        "tableColumnWidths",
        "TableTest.md",
        "| Name | Description | Score |",
        String(n),
      ]),
    occurrence,
  );
}

test("drag preserves total width, Markdown, other tables and survives reload", async ({
  page,
}) => {
  const server = await startReleaseServer();
  const path = join(server.spaceDir, "TableTest.md");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await writeFile(path, text);
    await ready(page, server.url);
    // Match the user's full-width, separately bordered table styling.
    await page.addStyleTag({
      content:
        "#sb-main .cm-editor table {width:100%;table-layout:auto;border-collapse:separate;border-spacing:0} #sb-main .cm-editor th,#sb-main .cm-editor td {padding:.65em .8em;white-space:normal;overflow-wrap:anywhere}",
    });
    const first = widgets(page).first();
    const before = await widths(first);
    const secondBefore = await widths(widgets(page).nth(1));
    const totalBefore = (await first.locator("table").boundingBox())!.width;
    const selection = await page.evaluate(
      () => (globalThis as any).client.editorView.state.selection.main.anchor,
    );
    await drag(page, first, 0, 65);
    await expect
      .poll(async () => (await widths(first))[0])
      .toBeGreaterThan(before[0] + 40);
    const after = await widths(first);
    expect(after[1]).toBeLessThan(before[1] - 40);
    expect(Math.abs(after[2] - before[2])).toBeLessThan(3);
    expect(
      Math.abs(
        (await first.locator("table").boundingBox())!.width - totalBefore,
      ),
    ).toBeLessThan(2);
    expect(await widths(widgets(page).nth(1))).toEqual(secondBefore);
    expect(
      await page.evaluate(
        () => (globalThis as any).client.editorView.state.selection.main.anchor,
      ),
    ).toBe(selection);
    await expect.poll(() => savedWidths(page)).not.toBeNull();
    expect(await savedWidths(page, 1)).toBeNull();
    const ratios = await savedWidths(page);
    await page.reload();
    await expect(widgets(page).first().locator("table")).toHaveClass(
      /sb-table-custom-widths/,
    );
    expect(await savedWidths(page)).toEqual(ratios);
    const afterReload = await widths(widgets(page).first());
    expect(
      Math.abs(
        afterReload[0] / afterReload.reduce((a, b) => a + b, 0) - ratios[0],
      ),
    ).toBeLessThan(0.01);
    // Ratios also survive a narrower viewport, rather than forcing a wide table.
    await page.setViewportSize({ width: 640, height: 900 });
    await expect
      .poll(async () => (await widths(widgets(page).first()))[0])
      .toBeLessThan(afterReload[0]);
    const narrower = await widths(widgets(page).first());
    expect(
      Math.abs(narrower[0] / narrower.reduce((a, b) => a + b, 0) - ratios[0]),
    ).toBeLessThan(0.02);
    const response = await page.request.get(`${server.url}/.fs/TableTest.md`);
    expect(await response.text()).toBe(text);
    expect(await readFile(path, "utf8")).toBe(text);
    await page.screenshot({ path: "test-results/table-resized.png" });
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("reset, keyboard adjustment and cancelled drags do not enter source editing", async ({
  page,
}) => {
  const server = await startReleaseServer();
  try {
    await writeFile(join(server.spaceDir, "TableTest.md"), text);
    await ready(page, server.url);
    const first = widgets(page).first();
    const handle = first.locator(".sb-table-column-handle").first();
    await handle.focus();
    await handle.press("ArrowRight");
    await expect.poll(() => savedWidths(page)).not.toBeNull();
    const committed = await savedWidths(page);
    const before = await widths(first);
    const rect = (await handle.boundingBox())!;
    await page.mouse.move(rect.x + 5, rect.y + 16);
    await page.mouse.down();
    await page.mouse.move(rect.x + 65, rect.y + 16, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await savedWidths(page)).toEqual(committed);
    const cancelled = await widths(first);
    expect(Math.abs(cancelled[0] - before[0])).toBeLessThan(2);
    await first.getByRole("button", { name: "Reset column widths" }).click();
    await expect(first.locator("colgroup")).toHaveCount(0);
    await expect.poll(() => savedWidths(page)).toBeNull();
    await drag(page, first, 0, 40);
    await expect.poll(() => savedWidths(page)).not.toBeNull();
    await handle.dblclick({ position: { x: 5, y: 16 } });
    await expect.poll(() => savedWidths(page)).toBeNull();
    await page.reload();
    await expect(
      widgets(page).first().locator(".sb-table-column-handle"),
    ).toHaveCount(2);
    await expect(widgets(page).first().locator("colgroup")).toHaveCount(0);
    expect(await readFile(join(server.spaceDir, "TableTest.md"), "utf8")).toBe(
      text,
    );
  } finally {
    await server.stop();
  }
});

test("normal cell editing still works and body edits preserve widths", async ({
  page,
}) => {
  const server = await startReleaseServer();
  try {
    await writeFile(join(server.spaceDir, "TableTest.md"), text);
    await writeFile(join(server.spaceDir, "OtherPage.md"), text);
    await ready(page, server.url);
    await drag(page, widgets(page).first(), 0, 45);
    await expect.poll(() => savedWidths(page)).not.toBeNull();
    const saved = await savedWidths(page);
    await widgets(page).first().locator("td").first().click();
    // The clicked table reveals its editable Markdown; the other stays rendered.
    await expect(widgets(page)).toHaveCount(1);
    const edited = text.replace("Alpha", "Alpha edited");
    await page.evaluate((source) => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: 0 },
      });
    }, edited);
    await expect(widgets(page)).toHaveCount(2);
    await expect(widgets(page).first().locator("table")).toHaveClass(
      /sb-table-custom-widths/,
    );
    expect(await savedWidths(page)).toEqual(saved);
    await expect
      .poll(() => readFile(join(server.spaceDir, "TableTest.md"), "utf8"))
      .toBe(edited);
    // Navigation to another page with identical table text must not reuse widths.
    await page.goto(`${server.url}/OtherPage?headless=1`);
    await expect(widgets(page)).toHaveCount(2);
    await expect(
      widgets(page).first().locator(".sb-table-column-handle"),
    ).toHaveCount(2);
    await expect(widgets(page).first().locator("colgroup")).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
