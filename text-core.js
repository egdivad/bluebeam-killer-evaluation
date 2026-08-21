export function shouldInsertText(tool, selectedId, targetIsAnnotation) {
  return tool === "insert" && !selectedId && !targetIsAnnotation;
}

export function createHighlightGeometry(boxes) {
  if (!boxes.length) return null;
  const lines = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const center = box.y + box.h / 2;
    let line = lines.find((item) => {
      const lineCenter = item.y + item.h / 2;
      return Math.abs(center - lineCenter) <= Math.max(box.h, item.h) * 0.55;
    });
    if (!line) {
      line = { ...box };
      lines.push(line);
      continue;
    }
    const right = Math.max(line.x + line.w, box.x + box.w);
    const bottom = Math.max(line.y + line.h, box.y + box.h);
    line.x = Math.min(line.x, box.x);
    line.y = Math.min(line.y, box.y);
    line.w = right - line.x;
    line.h = bottom - line.y;
  }

  const x = Math.min(...lines.map((line) => line.x));
  const y = Math.min(...lines.map((line) => line.y));
  const right = Math.max(...lines.map((line) => line.x + line.w));
  const bottom = Math.max(...lines.map((line) => line.y + line.h));
  return { x, y, w: right - x, h: bottom - y, rects: lines };
}

function sameTextStyle(a, b) {
  if (a.fontName && b.fontName && a.fontName !== b.fontName) return false;
  return a.fontFamily === b.fontFamily && a.fontWeight === b.fontWeight && a.fontStyle === b.fontStyle
    && Math.abs(a.fontHeight - b.fontHeight) / Math.max(a.fontHeight, b.fontHeight) < 0.12;
}

export function buildEditableTextBlocks(items, makeId = () => crypto.randomUUID()) {
  const lines = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.findLast((candidate) => Math.abs(candidate.y - item.y) <= Math.max(3, item.h * 0.35));
    if (!line) {
      line = { y: item.y, h: item.h, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.h = Math.max(line.h, item.h);
  }

  const segments = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let segment = null;
    for (const item of line.items) {
      const gap = segment ? item.x - segment.right : 0;
      if (!segment || gap > Math.max(40, item.fontHeight * 3) || !sameTextStyle(segment, item)) {
        segment = {
          id: makeId(), x: item.x, y: item.y, w: item.w, h: item.h, right: item.x + item.w,
          fontName: item.fontName, fontHeight: item.fontHeight, fontFamily: item.fontFamily,
          fontWeight: item.fontWeight, fontStyle: item.fontStyle, text: item.text, spans: [item.span],
        };
        segments.push(segment);
      } else {
        segment.text += gap > item.fontHeight * 0.18 ? ` ${item.text}` : item.text;
        segment.right = Math.max(segment.right, item.x + item.w);
        segment.w = segment.right - segment.x;
        segment.h = Math.max(segment.h, item.y + item.h - segment.y);
        segment.spans.push(item.span);
      }
    }
  }

  const blocks = [];
  for (const segment of segments.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const block = [...blocks].reverse().find((candidate) => {
      const gap = segment.y - (candidate.y + candidate.h);
      return gap >= -2 && gap <= Math.max(3, segment.h * 0.42)
        && Math.abs(segment.x - candidate.x) <= Math.max(segment.fontHeight * 1.8, 24)
        && sameTextStyle(segment, candidate);
    });
    if (block) {
      block.text += `\n${segment.text}`;
      block.w = Math.max(block.w, segment.right - block.x);
      block.h = Math.max(block.h, segment.y + segment.h - block.y);
      block.spans.push(...segment.spans);
    } else {
      blocks.push({ ...segment });
    }
  }
  for (const block of blocks) {
    for (const span of block.spans) if (span?.dataset) span.dataset.blockId = block.id;
  }
  return blocks;
}
