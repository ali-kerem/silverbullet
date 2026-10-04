import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import * as sass from "sass";

let javascript: string;
let css: string;
let browserErrors: string[];
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { EditorView } from "@codemirror/view";
        import { foldable, foldEffect, foldedRanges, forceParsing } from "@codemirror/language";
        import { createEditorState } from "./client/codemirror/editor_state.ts";
        globalThis.mountEditor = (text) => {
          globalThis.view?.destroy();
          const client = {
            ui: {viewState:{uiOptions:{markdownSyntaxRendering:true}}, viewDispatch:()=>{}},
            bootConfig:{readOnly:false},
            config:{get:(_key,fallback)=>fallback},
            clientSystem:{
              commandHook:{buildAllCommands:()=>new Map()},
              slashCommandHook:{slashCommandCompleter:()=>null},
              scriptsLoaded:false,
            },
            contentManager:{isDocumentEditor:()=>false},
            editorComplete:()=>null,
            currentPageMeta:()=>undefined,
            isReadOnlyMode:()=>false,
            dispatchAppEvent:()=>Promise.resolve(),
            focus:()=>{}, reportError:console.error,
          };
          const state=createEditorState(client,{kind:"page",pageName:"Fold demo"},text,false);
          const view=new EditorView({state,parent:document.querySelector("#sb-editor")});
          client.editorView=view;
          globalThis.view=view;
          forceParsing(view,view.state.doc.length,1000);
        };
        globalThis.foldCount=()=>foldedRanges(globalThis.view.state).size;
        globalThis.foldFirstLine=()=>{
          const view=globalThis.view, line=view.state.doc.line(1);
          const range=foldable(view.state,line.from,line.to);
          if(range) view.dispatch({effects:foldEffect.of(range)});
        };
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
    jsx: "automatic",
    jsxImportSource: "preact",
  });
  javascript = result.outputFiles[0].text;
  css = sass.compile("client/styles/main.scss").css;
});

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setContent('<div id="sb-main"><div id="sb-editor"></div></div>');
  await page.addStyleTag({ content: css });
  await page.addStyleTag({
    content:
      "html {--editor-width:800px;} #sb-main {position:static;} #sb-editor {height:90vh;}",
  });
  await page.addScriptTag({ content: javascript });
});

test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

const sample =
  "# Heading\n\nSection text\n\n## Child heading\n\nChild text\n\n# Next heading\n\nNext section\n";

test("clickable heading triangles collapse and expand without changing Markdown", async ({
  page,
}) => {
  await page.evaluate((text) => (globalThis as any).mountEditor(text), sample);
  const first = page.locator('.cm-foldGutter [title="Fold line"]').first();
  await expect(first).toBeVisible();
  await expect(first).toHaveText("▼");
  await first.click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as any).foldCount()))
    .toBe(1);
  await expect(page.locator(".cm-content")).not.toContainText("Section text");
  await expect(page.locator(".cm-content")).toContainText("Next heading");
  const closed = page
    .locator('.cm-foldGutter [title="Unfold line"]:visible')
    .first();
  await expect(closed).toHaveText("▶");
  await page.screenshot({ path: "../heading-collapsed.png" });
  await closed.click();
  await expect(page.locator(".cm-content")).toContainText("Section text");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe(sample);
  await page.screenshot({ path: "../heading-expanded.png" });
});

test("nested bullets and fenced code have no gutter triangles", async ({
  page,
}) => {
  const text =
    "- Parent\n  - Child one\n  - Child two\n- Sibling\n\n```markdown\n# Not a heading\n```\n";
  await page.evaluate((text) => (globalThis as any).mountEditor(text), text);
  await expect(page.locator('.cm-foldGutter [title="Fold line"]')).toHaveCount(
    0,
  );
  await expect(page.locator(".cm-content")).toContainText("Child one");
});

test("hidden bullet controls do not disable command folding", async ({
  page,
}) => {
  await page.evaluate(
    (text) => (globalThis as any).mountEditor(text),
    "- Parent\n  - Child\n- Sibling\n",
  );
  await page.evaluate(() => (globalThis as any).foldFirstLine());
  await expect(page.locator(".cm-content")).not.toContainText("Child");
  await expect(page.locator(".cm-content")).toContainText("Sibling");
  await expect(
    page.locator('.cm-foldGutter [title="Unfold line"]'),
  ).toHaveCount(0);
});

test("heading controls follow edits between headings and bullets", async ({
  page,
}) => {
  await page.evaluate(
    (text) => (globalThis as any).mountEditor(text),
    "# Heading\nbody\n",
  );
  await expect(page.locator('.cm-foldGutter [title="Fold line"]')).toHaveCount(
    1,
  );
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "- Parent\n  - Child\n",
      },
    });
  });
  await expect(page.locator('.cm-foldGutter [title="Fold line"]')).toHaveCount(
    0,
  );
});

test("triangles are vertically centered for all heading levels", async ({
  page,
}) => {
  const text =
    "# H1\nbody\n## H2\nbody\n### H3\nbody\n#### H4\nbody\n##### H5\nbody\n###### H6\nbody\n";
  await page.evaluate((text) => (globalThis as any).mountEditor(text), text);
  const markers = page.locator('.cm-foldGutter [title="Fold line"]');
  await expect(markers).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const triangle = await markers.nth(i).boundingBox();
    const heading = await page.locator(`.sb-line-h${i + 1}`).boundingBox();
    expect(
      Math.abs(
        triangle!.y + triangle!.height / 2 - (heading!.y + heading!.height / 2),
      ),
    ).toBeLessThan(1.5);
  }
});

test("triangles stay beside the centered text on a wide screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate((text) => (globalThis as any).mountEditor(text), sample);
  const marker = page.locator('.cm-foldGutter [title="Fold line"]').first();
  await expect(marker).toBeVisible();
  const triangle = await marker.boundingBox();
  const heading = await page.locator(".sb-line-h1").first().boundingBox();
  expect(triangle).not.toBeNull();
  expect(heading).not.toBeNull();
  expect(heading!.x - (triangle!.x + triangle!.width)).toBeLessThan(60);
  expect(heading!.x - (triangle!.x + triangle!.width)).toBeGreaterThanOrEqual(
    0,
  );
});

test("triangles work on a narrow screen without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate((text) => (globalThis as any).mountEditor(text), sample);
  const marker = page.locator('.cm-foldGutter [title="Fold line"]').first();
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page.locator(".cm-content")).not.toContainText("Section text");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
