import type { KvKey } from "@silverbulletmd/silverbullet/type/datastore";

export function tableWidthKey(
  page: string,
  header: string,
  occurrence: number,
): KvKey {
  // Body edits and text inserted above a table do not change its identity.
  // Repeated headers are distinguished by their occurrence within the page.
  return ["client", "tableColumnWidths", page, header, String(occurrence)];
}

export function normalizeWidths(
  value: unknown,
  count: number,
): number[] | null {
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    count < 2 ||
    !value.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
  ) {
    return null;
  }
  const total = value.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total)) return null;
  return value.map((n) => n / total);
}

export function resizeAdjacentColumns(
  widths: number[],
  index: number,
  delta: number,
): number[] {
  const result = [...widths];
  const pair = widths[index] + widths[index + 1];
  const minimum = Math.min(48, pair / 2);
  const left = Math.max(
    minimum,
    Math.min(pair - minimum, widths[index] + delta),
  );
  result[index] = left;
  result[index + 1] = pair - left;
  return result;
}

type ResizeOptions = {
  load: () => Promise<unknown>;
  save: (widths: number[] | null) => Promise<void>;
  changed: () => void;
  error: (error: unknown) => void;
};

/** UI-only widths: never rewrites the Markdown or changes the editor selection. */
export function attachTableResize(
  table: HTMLTableElement,
  options: ResizeOptions,
): () => void {
  const cells = Array.from(table.rows[0]?.cells ?? []);
  if (cells.length < 2 || cells.some((cell) => cell.colSpan !== 1))
    return () => {};
  const frame = document.createElement("span");
  frame.className = "sb-table-resize-frame";
  table.replaceWith(frame);
  frame.append(table);
  const originalStyle = table.getAttribute("style");
  const group = document.createElement("colgroup");
  const columns = cells.map(() => document.createElement("col"));
  group.append(...columns);
  let saved: number[] | null = null;
  let disposed = false;
  let interacted = false;
  let raf = 0;
  let cancelDrag: (() => void) | undefined;
  let writes = Promise.resolve();
  const events = new AbortController();
  const handles: HTMLElement[] = [];

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "sb-table-resize-control sb-table-width-reset";
  reset.textContent = "Reset column widths";
  reset.title = "Restore automatic column widths for this table";
  reset.hidden = true;
  frame.append(reset);

  const measureWidths = () =>
    cells.map((cell) => cell.getBoundingClientRect().width);
  const layout = () => {
    raf = 0;
    if (disposed || !frame.isConnected) return;
    const origin = frame.getBoundingClientRect();
    const box = table.getBoundingClientRect();
    const widths = measureWidths();
    for (let i = 0; i < handles.length; i++) {
      const rect = cells[i].getBoundingClientRect();
      const handle = handles[i];
      handle.style.left = `${rect.right - origin.left}px`;
      handle.style.top = `${box.top - origin.top}px`;
      handle.style.height = `${box.height}px`;
      handle.setAttribute("aria-valuenow", String(Math.round(widths[i])));
      handle.setAttribute("aria-valuemin", "0");
      handle.setAttribute(
        "aria-valuemax",
        String(Math.round(widths[i] + widths[i + 1])),
      );
      handle.setAttribute("aria-valuetext", `${Math.round(widths[i])} pixels`);
    }
    options.changed();
  };
  const scheduleLayout = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(layout);
  };
  const apply = (widths: number[] | null) => {
    saved = widths;
    reset.hidden = !widths;
    if (widths) {
      if (!group.isConnected) table.prepend(group);
      table.style.tableLayout = "fixed";
      table.style.width = "100%";
      table.classList.add("sb-table-custom-widths");
      columns.forEach((column, i) => {
        column.style.width = `${widths[i] * 100}%`;
      });
    } else {
      group.remove();
      if (originalStyle === null) table.removeAttribute("style");
      else table.setAttribute("style", originalStyle);
      table.classList.remove("sb-table-custom-widths");
    }
    scheduleLayout();
  };
  const persist = () => {
    const snapshot = saved ? [...saved] : null;
    // Serialize quick successive drags/reset so the last gesture wins.
    writes = writes.then(() => options.save(snapshot)).catch(options.error);
  };
  const stopEvent = (event: Event) => {
    event.stopPropagation();
  };
  frame.addEventListener(
    "click",
    (event) => {
      if ((event.target as Element).closest(".sb-table-resize-control"))
        stopEvent(event);
    },
    { signal: events.signal },
  );
  const resetWidths = () => {
    interacted = true;
    cancelDrag?.();
    apply(null);
    persist();
  };
  reset.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    { signal: events.signal },
  );
  reset.addEventListener("click", resetWidths, { signal: events.signal });

  for (let index = 0; index < cells.length - 1; index++) {
    const handle = document.createElement("span");
    handle.className = "sb-table-resize-control sb-table-column-handle";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute(
      "aria-label",
      `Resize columns ${index + 1} and ${index + 2}`,
    );
    handle.title =
      "Drag to resize columns; double-click to reset. Arrow keys adjust width.";
    handle.addEventListener(
      "dblclick",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetWidths();
      },
      { signal: events.signal },
    );
    handle.addEventListener(
      "keydown",
      (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "Escape"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          cancelDrag?.();
          return;
        }
        if (event.key === "Home") {
          resetWidths();
          return;
        }
        interacted = true;
        const delta =
          (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 10);
        apply(
          normalizeWidths(
            resizeAdjacentColumns(measureWidths(), index, delta),
            cells.length,
          ),
        );
        persist();
      },
      { signal: events.signal },
    );
    handle.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0 || cancelDrag) return;
        event.preventDefault();
        event.stopPropagation();
        interacted = true;
        const original = saved;
        const widths = measureWidths();
        const startX = event.clientX;
        const pointerId = event.pointerId;
        let moved = false;
        const dragEvents = new AbortController();
        frame.classList.add("sb-table-resizing");
        handle.focus({ preventScroll: true });
        handle.setPointerCapture(pointerId);
        const finish = (commit: boolean) => {
          if (!cancelDrag) return;
          cancelDrag = undefined;
          dragEvents.abort();
          frame.classList.remove("sb-table-resizing");
          if (handle.hasPointerCapture(pointerId))
            handle.releasePointerCapture(pointerId);
          if (commit && moved) persist();
          else apply(original);
        };
        cancelDrag = () => finish(false);
        handle.addEventListener(
          "pointermove",
          (move) => {
            if (move.pointerId !== pointerId) return;
            const delta = move.clientX - startX;
            if (!moved && Math.abs(delta) < 2) return;
            moved = true;
            apply(
              normalizeWidths(
                resizeAdjacentColumns(widths, index, delta),
                cells.length,
              ),
            );
          },
          { signal: dragEvents.signal },
        );
        handle.addEventListener(
          "pointerup",
          (up) => {
            if (up.pointerId === pointerId) finish(true);
          },
          { signal: dragEvents.signal },
        );
        handle.addEventListener("pointercancel", () => finish(false), {
          signal: dragEvents.signal,
        });
        handle.addEventListener("lostpointercapture", () => finish(false), {
          signal: dragEvents.signal,
        });
      },
      { signal: events.signal },
    );
    handles.push(handle);
    frame.append(handle);
  }
  const observer = new ResizeObserver(scheduleLayout);
  observer.observe(table);
  observer.observe(frame);
  scheduleLayout();
  void options
    .load()
    .then((value) => {
      if (!disposed && !interacted) apply(normalizeWidths(value, cells.length));
    })
    .catch(options.error);
  return () => {
    disposed = true;
    cancelDrag?.();
    observer.disconnect();
    events.abort();
    if (raf) cancelAnimationFrame(raf);
  };
}
