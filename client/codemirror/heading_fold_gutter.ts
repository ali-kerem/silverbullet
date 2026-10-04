import {
  foldable,
  foldEffect,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import {
  type BlockInfo,
  type EditorView,
  GutterMarker,
  gutter,
} from "@codemirror/view";

function isHeading(state: EditorState, from: number): boolean {
  const line = state.doc.lineAt(from);
  let node = syntaxTree(state).resolveInner(line.from, 1);
  while (node) {
    if (/^(ATX|Setext)Heading[1-6]$/.test(node.name))
      return node.from === line.from;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

function foldedOnLine(state: EditorState, line: BlockInfo) {
  let range: { from: number; to: number } | null = null;
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    if (!range) range = { from, to };
  });
  return range;
}

class HeadingFoldMarker extends GutterMarker {
  constructor(readonly open: boolean) {
    super();
  }
  eq(other: HeadingFoldMarker) {
    return other.open === this.open;
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.textContent = this.open ? "▼" : "▶";
    span.title = view.state.phrase(this.open ? "Fold line" : "Unfold line");
    return span;
  }
}
const expanded = new HeadingFoldMarker(true);
const collapsed = new HeadingFoldMarker(false);
class HeadingFoldSpacer extends GutterMarker {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "\u00a0";
    return span;
  }
}
const spacer = new HeadingFoldSpacer();

// Restrict clickable controls, not the underlying folding commands/ranges.
export function headingFoldGutter(): Extension {
  return gutter({
    class: "cm-foldGutter",
    initialSpacer: () => spacer,
    lineMarker: (view, line) => {
      if (!isHeading(view.state, line.from)) return null;
      if (foldedOnLine(view.state, line)) return collapsed;
      return foldable(view.state, line.from, line.to) ? expanded : null;
    },
    lineMarkerChange: (update) =>
      syntaxTree(update.startState) !== syntaxTree(update.state) ||
      foldedRanges(update.startState) !== foldedRanges(update.state),
    domEventHandlers: {
      click: (view, line) => {
        if (!isHeading(view.state, line.from)) return false;
        const folded = foldedOnLine(view.state, line);
        if (folded) {
          view.dispatch({ effects: unfoldEffect.of(folded) });
          return true;
        }
        const range = foldable(view.state, line.from, line.to);
        if (!range) return false;
        view.dispatch({ effects: foldEffect.of(range) });
        return true;
      },
    },
  });
}
