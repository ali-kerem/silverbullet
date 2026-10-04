import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import * as sass from "sass";

let javascript: string;
let css: string;
let browserErrors: string[];

const origin = "http://spaces.test";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="purple"/></svg>';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { EditorView } from "@codemirror/view";
        import { undo } from "@codemirror/commands";
        import { forceParsing } from "@codemirror/language";
        import { createEditorState } from "./client/codemirror/editor_state.ts";
        import { WidgetCache } from "./client/widget_cache.ts";
        globalThis.mountEditor = (text, readOnly = false) => {
          globalThis.view?.destroy();
          const client = {
            ui: {viewState:{uiOptions:{markdownSyntaxRendering:false}, allPages:[]}, viewDispatch:()=>{}},
            bootConfig:{readOnly},
            config:{get:(_key,fallback)=>fallback},
            systemReady:true, fullIndexCompleted:true, pageListLoaded:true,
            widgetCache:new WidgetCache({get:async()=>null,set:async()=>{}}),
            space:{},
            clientSystem:{
              commandHook:{buildAllCommands:()=>new Map()},
              slashCommandHook:{slashCommandCompleter:()=>null},
              scriptsLoaded:true,
              allKnownFiles:{has:()=>false,candidates:()=>[]},
              spaceLuaEnv:{},
            },
            contentManager:{isDocumentEditor:()=>false},
            editorComplete:()=>null,
            currentPageMeta:()=>undefined,
            currentPath:()=>"Resize demo.md",
            currentName:()=>"Resize demo",
            isReadOnlyMode:()=>readOnly,
            dispatchAppEvent:()=>Promise.resolve(),
            focus:()=>{}, reportError:console.error,
          };
          const state=createEditorState(client,{kind:"page",pageName:"Resize demo"},text,readOnly);
          const view=new EditorView({state,parent:document.querySelector("#sb-editor")});
          client.editorView=view;
          globalThis.view=view;
          forceParsing(view,view.state.doc.length,1000);
          // Inline content widgets are only rendered when the cursor is elsewhere.
          view.dispatch({selection:{anchor:0}});
        };
        globalThis.docText=()=>globalThis.view.state.doc.toString();
        globalThis.undoLast=()=>undo(globalThis.view);
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
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(".png")) {
      return route.fulfill({ contentType: "image/svg+xml", body: svg });
    }
    return route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div id="sb-main"><div id="sb-editor"></div></div>',
    });
  });
  await page.goto(`${origin}/`);
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

const sample = "Intro\n\n![[img.png|alias|300]]\n\nOutro\n";

async function mount(page: Page, text: string, readOnly = false) {
  await page.evaluate(([t, r]) => (globalThis as any).mountEditor(t, r), [
    text,
    readOnly,
  ] as const);
  const img = page.locator(".sb-image-resizer img");
  await expect(img).toBeVisible();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".sb-image-resizer img")].every(
      (i) => (i as HTMLImageElement).complete,
    ),
  );
  return img;
}

const docText = (page: Page) =>
  page.evaluate(() => (globalThis as any).docText() as string);

async function drag(page: Page, side: "left" | "right", dx: number) {
  const resizer = page.locator(".sb-image-resizer");
  await resizer.hover();
  const handle = page.locator(`.sb-image-resize-${side}`);
  await expect(handle).toHaveCSS("opacity", "1");
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 3 });
  await page.mouse.move(x + dx, y, { steps: 3 });
  await page.mouse.up();
}

test("dragging the right handle widens the image and rewrites its width", async ({
  page,
}) => {
  const img = await mount(page, sample);
  expect((await img.boundingBox())!.width).toBeCloseTo(300, 0);

  await drag(page, "right", 60);

  await expect
    .poll(() => docText(page))
    .toBe("Intro\n\n![[img.png|alias|420]]\n\nOutro\n");
  const resized = page.locator(".sb-image-resizer img");
  await expect.poll(async () => (await resized.boundingBox())?.width).toBe(420);

  // The frame still hugs the image and stays centered.
  const frame = (await page.locator(".sb-inline-content").boundingBox())!;
  const imgBox = (await resized.boundingBox())!;
  expect(frame.width - imgBox.width).toBeLessThanOrEqual(2);
  const host = (await page.locator(".sb-lua-wrapper").boundingBox())!;
  const left = frame.x - host.x;
  const right = host.x + host.width - (frame.x + frame.width);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);

  // A single undo restores the original Markdown and size.
  await page.evaluate(() => (globalThis as any).undoLast());
  expect(await docText(page)).toBe(sample);
  await expect
    .poll(
      async () =>
        (await page.locator(".sb-image-resizer img").boundingBox())?.width,
    )
    .toBe(300);
});

test("dragging the left handle inward shrinks the image", async ({ page }) => {
  await mount(page, "Intro\n\n![alt](img.png)\n\nAfter\n");
  const startWidth = (await page
    .locator(".sb-image-resizer img")
    .boundingBox())!.width;
  await drag(page, "left", 50);
  // Moving the left edge right shrinks the centered image by twice the delta.
  await expect
    .poll(() => docText(page))
    .toBe(
      `Intro\n\n![alt|${Math.round(startWidth - 100)}](img.png)\n\nAfter\n`,
    );
});

test("width is clamped to the editor width", async ({ page }) => {
  await mount(page, sample);
  await drag(page, "right", 2000);
  const host = (await page.locator(".sb-lua-wrapper").boundingBox())!;
  await expect
    .poll(() => docText(page))
    .toBe(
      `Intro\n\n![[img.png|alias|${Math.round(host.width - 2)}]]\n\nOutro\n`,
    );
});

test("a click without dragging leaves the Markdown unchanged", async ({
  page,
}) => {
  await mount(page, sample);
  await drag(page, "right", 0);
  expect(await docText(page)).toBe(sample);
});

test("read-only pages get no handles", async ({ page }) => {
  await mount(page, sample, true);
  await expect(page.locator(".sb-image-resize-handle")).toHaveCount(0);
});
