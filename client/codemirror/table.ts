import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { Client } from "../client.ts";
import { lezerToParseTree } from "../markdown_parser/parse_tree.ts";
import { expandMarkdown } from "../markdown_renderer/inline.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import { attachTableResize, tableWidthKey } from "./table_resize.ts";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
} from "./util.ts";
import {
  attachWidgetEventHandlers,
  buildResolveTransclusion,
  buildTranslateUrls,
} from "./widget_util.ts";

class TableViewWidget extends WidgetType {
  tableBodyText: string;
  private readonly lifetimes = new WeakMap<HTMLElement, AbortController>();

  constructor(
    readonly client: Client,
    readonly t: ParseTree,
    readonly pagePath: string,
    readonly header: string,
    readonly occurrence: number,
  ) {
    super();
    this.tableBodyText = renderToText(t);
  }

  override get estimatedHeight(): number {
    return this.client.widgetCache.getCachedWidgetHeight(
      `table:${this.tableBodyText}`,
    );
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    const lifetime = new AbortController();
    this.lifetimes.set(dom, lifetime);
    dom.classList.add("sb-table-widget");
    dom.addEventListener("click", (e) => {
      if ((e.target as Element).closest(".sb-table-resize-control")) return;
      const dataAttributes = (e.target as any).dataset;
      const fallbackPos = this.client.editorView.posAtDOM(dom, 0);
      this.client.editorView.dispatch({
        selection: {
          anchor: dataAttributes.pos ? +dataAttributes.pos : fallbackPos,
        },
      });
    });

    const resolveTransclusion = buildResolveTransclusion(this.client);
    void expandMarkdown(
      this.client.space,
      this.client.currentName(),
      this.t,
      this.client.clientSystem.spaceLuaEnv,
      {
        syntaxExtensions: this.client.config.get("syntaxExtensions", {}),
        resolveTransclusion,
      },
    ).then((t) => {
      if (lifetime.signal.aborted) return;
      dom.innerHTML = renderMarkdownToHtml(t, {
        // Annotate every element with its position so we can use it to put
        // the cursor there when the user clicks on the table.
        annotationPositions: true,
        shortWikiLinks: this.client.config.get("shortWikiLinks", true),
        translateUrls: buildTranslateUrls(this.client),
        resolveTransclusion,
      });
      setTimeout(() => {
        if (lifetime.signal.aborted) return;
        attachWidgetEventHandlers(dom, this.client, this.tableBodyText);

        const table = dom.querySelector("table");
        if (table) {
          const key = tableWidthKey(
            this.pagePath,
            this.header,
            this.occurrence,
          );
          const cleanup = attachTableResize(table, {
            load: () => this.client.ds.get(key),
            save: (widths) =>
              widths
                ? this.client.ds.set(key, widths)
                : this.client.ds.delete(key),
            changed: () => {
              this.client.widgetCache.setCachedWidgetMeta(
                `table:${this.tableBodyText}`,
                { height: dom.clientHeight, block: true },
              );
              this.client.editorView.requestMeasure();
            },
            error: (error) =>
              this.client.reportError(error, "Saving table column widths"),
          });
          lifetime.signal.addEventListener("abort", cleanup, { once: true });
        }

        this.client.widgetCache.setCachedWidgetMeta(
          `table:${this.tableBodyText}`,
          { height: dom.clientHeight, block: true },
        );
      });
    });
    return dom;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof TableViewWidget &&
      other.tableBodyText === this.tableBodyText &&
      other.pagePath === this.pagePath &&
      other.header === this.header &&
      other.occurrence === this.occurrence
    );
  }

  override destroy(dom: HTMLElement): void {
    this.lifetimes.get(dom)?.abort();
    this.lifetimes.delete(dom);
  }
}

export function tablePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    const occurrences = new Map<string, number>();
    syntaxTree(state).iterate({
      enter: (node) => {
        const { from, to, name } = node;
        if (name !== "Table") return;
        const header = state.doc.lineAt(from).text.trim();
        const occurrence = occurrences.get(header) ?? 0;
        occurrences.set(header, occurrence + 1);
        if (isCursorInRange(state, [from, to])) return;

        hideBlockSource(widgets, state, from, to, "start");

        const text = state.sliceDoc(0, to);
        widgets.push(
          Decoration.widget({
            widget: new TableViewWidget(
              editor,
              lezerToParseTree(text, node.node),
              editor.currentPath(),
              header,
              occurrence,
            ),
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
