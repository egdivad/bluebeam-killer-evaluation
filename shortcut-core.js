export function shortcutCommand(event) {
  const key = event.key.toLowerCase();
  const ctrl = Boolean(event.ctrlKey || event.metaKey);
  const shift = Boolean(event.shiftKey);
  const alt = Boolean(event.altKey);

  if (shift && alt && !ctrl) {
    return ({ a: "measure-area", c: "measure-count", d: "measure-diameter", g: "measure-angle", l: "measure-length", p: "measure-perimeter", q: "measure-polyline" })[key] || null;
  }
  if (ctrl && alt) {
    return ({ b: "align-bottom", e: "align-center", l: "align-left", m: "align-vertical", r: "align-right", t: "align-top" })[key] || null;
  }
  if (ctrl && shift && !alt) {
    if (key === "z") return "redo";
    return ({ c: "format-painter", d: "delete-page", n: "insert-page", s: "export" })[key] || null;
  }
  if (ctrl && !shift && !alt) {
    if (key === "arrowleft") return "previous-page";
    if (key === "arrowright") return "next-page";
    return ({ "0": "fit-width", "4": "layout-single", "5": "layout-continuous", "6": "layout-side", "7": "layout-continuous-side", "8": "actual-size", "9": "fit-page", f: "search", o: "open", s: "export", y: "redo", z: "undo" })[key] || null;
  }
  if (ctrl || alt) return null;
  if (event.key === "Delete") return "delete";
  if (event.key === "Home") return "first-page";
  if (event.key === "End") return "last-page";
  if (event.key === "F1") return "show-shortcuts";
  if (event.key === "+" || event.key === "=") return "zoom-in";
  if (event.key === "-") return "zoom-out";
  if (shift) return ({ e: "edit", f: "markup-flag", p: "markup-polygon" })[key] || null;
  return ({ v: "select", h: "highlight", t: "insert", c: "markup-cloud", a: "markup-arrow", r: "markup-rectangle", e: "markup-ellipse", l: "markup-line", q: "markup-callout" })[key] || null;
}
