import { expect, test } from "@playwright/test";
import * as sass from "sass";

let css: string;
test.beforeAll(() => {
  css = sass.compile("client/styles/main.scss").css;
});

// Mirrors the DOM LuaWidget.wrapHtml builds for an inline-content widget.
function widget(id: string, inner: string) {
  return `<div id="${id}" class="sb-inline-content sb-lua-directive-block"><div><div class="button-bar"><button>A</button><button>B</button></div><div class="content">${inner}</div></div></div>`;
}

const pixel =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="purple"/></svg>',
  );

test.beforeEach(async ({ page }) => {
  await page.setContent(
    `<div id="sb-main"><div class="cm-editor"><div class="cm-content" style="width:800px;padding:0">
      ${widget("resized", `<img src="${pixel}" style="max-width:100%;width:300px">`)}
      ${widget("natural", `<img src="${pixel}" style="max-width:100%">`)}
      ${widget("page", `<span class="wrapper"><p>Text</p><img src="${pixel}" style="max-width:100%;width:100px"></span>`)}
    </div></div></div>`,
  );
  await page.addStyleTag({ content: css });
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete),
  );
});

async function boxes(page: import("@playwright/test").Page, id: string) {
  const frame = (await page.locator(`#${id}`).boundingBox())!;
  const parent = (await page.locator(".cm-content").boundingBox())!;
  const img = await page.locator(`#${id} img`).boundingBox();
  return { frame, parent, img: img! };
}

test("resized image frame hugs the image and is centered", async ({ page }) => {
  const { frame, parent, img } = await boxes(page, "resized");
  expect(img.width).toBeCloseTo(300, 0);
  expect(frame.width).toBeLessThanOrEqual(img.width + 2);
  const left = frame.x - parent.x;
  const right = parent.x + parent.width - (frame.x + frame.width);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

test("oversized image stays within the editor width", async ({ page }) => {
  const { frame, parent, img } = await boxes(page, "natural");
  expect(frame.width).toBeLessThanOrEqual(parent.width);
  expect(img.width).toBeLessThanOrEqual(frame.width);
});

test("page transclusions keep the full-width frame", async ({ page }) => {
  const { frame, parent } = await boxes(page, "page");
  expect(frame.width).toBeCloseTo(parent.width, 0);
});
