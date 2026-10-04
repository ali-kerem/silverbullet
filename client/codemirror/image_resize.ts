import type { Client } from "../client.ts";
import { mdLinkRegex, wikiLinkRegex } from "../markdown_parser/constants.ts";
import { findWidgetSourceRange } from "./widget_util.ts";

const minImageWidth = 48;

/** Cache key used by the inline content widget for a transclusion's source text */
export function inlineContentCacheKey(client: Client, text: string): string {
  return `widget:${client.currentPath()}:${text}`;
}

/**
 * Returns `text` (a `![[...]]` or `![...](...)` transclusion) with its width
 * set to `width`, keeping the alias and dropping any height so the aspect
 * ratio is preserved. Returns null if `text` is not a transclusion.
 */
export function setTransclusionWidth(
  text: string,
  width: number,
): string | null {
  const md = new RegExp(mdLinkRegex.source).exec(text);
  if (md?.groups && text.startsWith("!", md.index)) {
    const rebuilt = `![${withWidth(md.groups.title, width)}](${md.groups.url})`;
    return replaceMatch(text, md, rebuilt);
  }
  const wiki = new RegExp(wikiLinkRegex.source).exec(text);
  if (wiki?.groups && wiki.groups.leadingTrivia === "![[") {
    const { stringRef, alias, trailingTrivia } = wiki.groups;
    const rebuilt = `![[${stringRef}|${withWidth(alias ?? "", width)}${trailingTrivia}`;
    return replaceMatch(text, wiki, rebuilt);
  }
  return null;
}

function replaceMatch(text: string, match: RegExpExecArray, by: string) {
  return (
    text.slice(0, match.index) + by + text.slice(match.index + match[0].length)
  );
}

// Mirrors parseDimensionFromAlias: "alias|WxH", "WxH" or "alias".
function withWidth(label: string, width: number): string {
  const pipe = label.indexOf("|");
  if (pipe !== -1) {
    return `${label.slice(0, pipe)}|${width}`;
  }
  if (label === "" || /^\d*(x\d*)?$/.test(label)) {
    return `${width}`;
  }
  return `${label}|${width}`;
}

/**
 * Wraps an embedded image with left/right drag handles. Dragging resizes the
 * (centered) image symmetrically; releasing writes the new width into the
 * transclusion's source text, so it persists and can be undone.
 */
export function makeResizableImage(
  img: HTMLImageElement,
  client: Client,
  sourceText: string,
): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "sb-image-resizer";
  wrapper.append(img);
  if (client.isReadOnlyMode() || !setTransclusionWidth(sourceText, 1)) {
    return wrapper;
  }
  for (const side of ["left", "right"] as const) {
    const handle = document.createElement("span");
    handle.className = `sb-image-resize-handle sb-image-resize-${side}`;
    handle.title = "Drag to resize";
    handle.addEventListener("pointerdown", (e) =>
      startResize(e, side, img, wrapper, client, sourceText),
    );
    wrapper.append(handle);
  }
  return wrapper;
}

function startResize(
  e: PointerEvent,
  side: "left" | "right",
  img: HTMLImageElement,
  wrapper: HTMLElement,
  client: Client,
  sourceText: string,
) {
  if (e.button !== 0 || client.isReadOnlyMode()) {
    return;
  }
  // Also suppresses the compatibility mousedown that would move the cursor.
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);

  const original = { width: img.style.width, height: img.style.height };
  const startX = e.clientX;
  const startWidth = img.getBoundingClientRect().width;
  const host = wrapper.closest<HTMLElement>(".sb-lua-wrapper");
  // Leave room for the frame's 1px borders.
  const maxWidth = host ? host.clientWidth - 2 : Number.POSITIVE_INFINITY;
  const direction = side === "right" ? 1 : -1;
  let width = Math.round(startWidth);
  wrapper.classList.add("sb-image-resizing");

  const onMove = (ev: PointerEvent) => {
    // The image is centered, so each edge moves by the pointer delta.
    const wanted = startWidth + direction * 2 * (ev.clientX - startX);
    width = Math.round(
      Math.min(Math.max(wanted, minImageWidth), Math.max(maxWidth, 1)),
    );
    img.style.width = `${width}px`;
    img.style.height = "";
  };
  const finish = (commit: boolean) => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onCancel);
    wrapper.classList.remove("sb-image-resizing");
    const changed = commit && Math.abs(width - startWidth) >= 1;
    if (changed) {
      commitWidth(wrapper, client, sourceText, width);
    }
    // The rendered element is cached per source text and reused (e.g. after
    // undo), so it must keep showing the size its source text specifies.
    img.style.width = original.width;
    img.style.height = original.height;
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onCancel);
}

function commitWidth(
  wrapper: HTMLElement,
  client: Client,
  sourceText: string,
  width: number,
) {
  const widgetDom = wrapper.closest<HTMLElement>(".sb-lua-wrapper");
  const newText = setTransclusionWidth(sourceText, width);
  if (!widgetDom || !newText || newText === sourceText) {
    return;
  }
  const range = findWidgetSourceRange(client, widgetDom, sourceText);
  if (!range) {
    return;
  }
  // Reserve the current height for the re-rendered widget to avoid a jump.
  const frame = wrapper.closest<HTMLElement>(".sb-inline-content");
  if (frame) {
    client.widgetCache.setCachedWidgetMeta(
      inlineContentCacheKey(client, newText),
      { height: frame.offsetHeight, block: true },
    );
  }
  client.editorView.dispatch({
    changes: { ...range, insert: newText },
    userEvent: "input.resize",
  });
}
