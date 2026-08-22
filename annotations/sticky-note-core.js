export const STICKY_NOTE_STATUSES = ["None", "Accepted", "Rejected", "Completed", "Cancelled"];
export const STICKY_NOTE_COLORS = ["#f6c344", "#86e59d", "#7cc8ff", "#ff9fc6", "#ffb66e", "#c4a8ff"];
export const STICKY_NOTE_SIZE = 24;
export const STICKY_NOTE_FORMAT_KEYS = ["color", "subject", "author", "status"];

const isoDate = value => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

export function makeStickyNote({ id, page = 1, pageId = null, x = 0, y = 0, now = new Date().toISOString() } = {}) {
  const createdDate = isoDate(now);
  return {
    id,
    type: "sticky-note",
    page,
    pageId,
    x: Number(x) || 0,
    y: Number(y) || 0,
    w: STICKY_NOTE_SIZE,
    h: STICKY_NOTE_SIZE,
    text: "",
    subject: "Sticky Note",
    author: "",
    status: "None",
    color: STICKY_NOTE_COLORS[0],
    iconName: "Note",
    createdDate,
    modifiedDate: createdDate,
    layerId: null,
    layerName: "",
    visible: true,
  };
}

export function touchStickyNote(note, now = new Date().toISOString()) {
  if (!note || note.type !== "sticky-note") return note;
  note.modifiedDate = isoDate(now);
  return note;
}

export function normalizeStickyNote(note = {}) {
  const normalized = Object.assign(makeStickyNote({
    id: note.id,
    page: note.page,
    pageId: note.pageId,
    x: note.x,
    y: note.y,
    now: note.createdDate || note.modifiedDate,
  }), note);
  normalized.w = STICKY_NOTE_SIZE;
  normalized.h = STICKY_NOTE_SIZE;
  normalized.text = String(normalized.text || "");
  normalized.subject = String(normalized.subject || "Sticky Note").slice(0, 200);
  normalized.author = String(normalized.author || "").slice(0, 200);
  normalized.status = STICKY_NOTE_STATUSES.includes(normalized.status) ? normalized.status : "None";
  normalized.color = /^#[0-9a-f]{6}$/i.test(normalized.color || "") ? normalized.color : STICKY_NOTE_COLORS[0];
  normalized.createdDate = isoDate(normalized.createdDate);
  normalized.modifiedDate = isoDate(normalized.modifiedDate || normalized.createdDate);
  return normalized;
}

export function stickyNoteDateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}
