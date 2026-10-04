import { expect, type Page, test } from "@playwright/test";
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
            ui: {viewState:{uiOptions:{markdownSyntaxRendering:globalThis.syntaxRendering ?? true}}, viewDispatch:()=>{}},
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

async function highlightStyle(
  page: Page,
  theme: "dark" | "light",
  syntaxRendering = true,
) {
  await page.evaluate(
    ([t, r]) => {
      document.documentElement.dataset.theme = t as string;
      (globalThis as any).syntaxRendering = r;
      (globalThis as any).mountEditor(
        "Intro line\n\nThe agent ==pinpoints the **ROI** with [a link](https://example.com)== and moves on.\n",
      );
    },
    [theme, syntaxRendering] as const,
  );
  const marker = page
    .locator(".cm-content .sb-highlight", { hasText: "pinpoints" })
    .first();
  await expect(marker).toBeVisible();
  return marker.evaluate((el) => {
    const s = getComputedStyle(el);
    const link = el
      .closest(".cm-line")!
      .querySelector(".sb-highlight.sb-link:not(.sb-meta, .sb-url)");
    return {
      background: s.backgroundColor,
      color: s.color,
      linkColor: getComputedStyle(link!).color,
      pageColor: getComputedStyle(el.closest(".cm-line")!).color,
    };
  });
}

test("dark mode highlights are opaque yellow with dark text", async ({
  page,
}) => {
  const style = await highlightStyle(page, "dark");
  expect(style.background).toBe("rgb(245, 213, 71)");
  expect(style.color).toBe("rgb(22, 19, 10)");
  expect(style.linkColor).toBe("rgb(30, 58, 138)");
  await page.locator("#sb-editor").screenshot({
    path: "test-results/highlight-dark.png",
  });
});

test("light mode highlights keep the page text color", async ({ page }) => {
  const style = await highlightStyle(page, "light");
  expect(style.background).toBe("rgba(255, 255, 0, 0.5)");
  expect(style.color).toBe(style.pageColor);
});

test("dark mode highlight with Markdown syntax hidden", async ({ page }) => {
  await page.addStyleTag({
    content:
      "body{background:#111;margin:0} #sb-editor{height:160px} .cm-content{font:16px/1.65 system-ui,sans-serif}",
  });
  const style = await highlightStyle(page, "dark", false);
  expect(style.background).toBe("rgb(245, 213, 71)");
  expect(style.color).toBe("rgb(22, 19, 10)");
  expect(style.linkColor).toBe("rgb(30, 58, 138)");
  // Hidden `==`/`**` marks leave no unhighlighted gaps between the pieces.
  await expect(page.locator(".cm-content .sb-highlight.sb-meta")).toHaveCount(
    0,
  );
  await page.locator("#sb-editor").screenshot({
    path: "test-results/highlight-dark-hidden-syntax.png",
  });
});
