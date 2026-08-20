export function makeSourcePages(count, makeId = () => crypto.randomUUID()) {
  return Array.from({ length: count }, (_, index) => ({
    id: makeId(),
    sourceIndex: index + 1,
    blank: false,
  }));
}

export function syncAnnotationPages(pages, annotations) {
  const pageNumbers = new Map(pages.map((page, index) => [page.id, index + 1]));
  for (const annotation of annotations) {
    if (annotation.pageId && pageNumbers.has(annotation.pageId)) {
      annotation.page = pageNumbers.get(annotation.pageId);
    }
  }
}

export function reorderPage(pages, annotations, from, to) {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return false;
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  syncAnnotationPages(pages, annotations);
  return true;
}

export function removePage(pages, annotations, index) {
  if (pages.length <= 1 || index < 0 || index >= pages.length) return null;
  const [removed] = pages.splice(index, 1);
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    if (annotations[i].pageId === removed.id) annotations.splice(i, 1);
  }
  syncAnnotationPages(pages, annotations);
  return removed;
}

export function addBlankPage(pages, annotations, index, size, makeId = () => crypto.randomUUID()) {
  const page = { id: makeId(), blank: true, width: size.width, height: size.height };
  pages.splice(index, 0, page);
  syncAnnotationPages(pages, annotations);
  return page;
}

export function getExportPlan(pages, annotations) {
  const editedPageIds = new Set(
    annotations.filter((annotation) => annotation.type === "replacement").map((annotation) => annotation.pageId),
  );
  return pages.map((page, index) => ({
    page,
    pageNumber: index + 1,
    flattenSource: !page.blank && editedPageIds.has(page.id),
  }));
}

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

export function annotationsForPageId(annotations, pageId) {
  return annotations.filter((annotation) => annotation.pageId === pageId);
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

export function alignElementToPage(element, pageSize, mode) {
  const maxX = Math.max(0, pageSize.width - element.w);
  const maxY = Math.max(0, pageSize.height - element.h);
  const position = { x: Math.min(Math.max(0, element.x), maxX), y: Math.min(Math.max(0, element.y), maxY) };
  if (mode === "center" || mode === "horizontal") position.x = maxX / 2;
  if (mode === "center" || mode === "vertical") position.y = maxY / 2;
  if (mode === "left") position.x = 0;
  if (mode === "right") position.x = maxX;
  if (mode === "top") position.y = 0;
  if (mode === "bottom") position.y = maxY;
  return position;
}

export function constrainMoveDelta(dx, dy, shiftKey) {
  if (!shiftKey) return { dx, dy };
  if (!dx && !dy) return { dx: 0, dy: 0 };
  const step = Math.PI / 4, angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const unitX = Math.cos(angle), unitY = Math.sin(angle), distance = dx * unitX + dy * unitY;
  const clean = value => Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(12));
  return { dx: clean(unitX * distance), dy: clean(unitY * distance) };
}

export function calculatePanScroll(startScroll, startPointer, currentPointer) {
  return {
    left: Math.max(0, startScroll.left - (currentPointer.x - startPointer.x)),
    top: Math.max(0, startScroll.top - (currentPointer.y - startPointer.y)),
  };
}

export function calculateAnchoredScroll(currentScroll, anchorClient, renderedPointClient) {
  return {
    left: Math.max(0, currentScroll.left + renderedPointClient.x - anchorClient.x),
    top: Math.max(0, currentScroll.top + renderedPointClient.y - anchorClient.y),
  };
}

export function constrainPointToAxis(anchor, point, shiftKey) {
  if (!shiftKey || !anchor) return { ...point };
  const { dx, dy } = constrainMoveDelta(point.x - anchor.x, point.y - anchor.y, true);
  return { x: anchor.x + dx, y: anchor.y + dy };
}

function nearestPointOnSegment(point, segment) {
  const [start, end] = segment;
  const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return { point: { x: start.x + dx * amount, y: start.y + dy * amount }, amount };
}

function axisPointOnSegment(point, segment, axis, anchor) {
  const [start, end] = segment, epsilon = 1e-7;
  if (axis === "horizontal") {
    if (Math.abs(start.y - anchor.y) < epsilon && Math.abs(end.y - anchor.y) < epsilon) {
      const candidate = nearestPointOnSegment(point, segment);candidate.point.y = anchor.y;return candidate;
    }
    const denominator = end.y - start.y;
    if (Math.abs(denominator) < epsilon) return null;
    const amount = (anchor.y - start.y) / denominator;
    return amount >= 0 && amount <= 1 ? { point: { x: start.x + (end.x - start.x) * amount, y: anchor.y }, amount } : null;
  }
  if (axis === "vertical") {
    if (Math.abs(start.x - anchor.x) < epsilon && Math.abs(end.x - anchor.x) < epsilon) {
      const candidate = nearestPointOnSegment(point, segment);candidate.point.x = anchor.x;return candidate;
    }
    const denominator = end.x - start.x;
    if (Math.abs(denominator) < epsilon) return null;
    const amount = (anchor.x - start.x) / denominator;
    return amount >= 0 && amount <= 1 ? { point: { x: anchor.x, y: start.y + (end.y - start.y) * amount }, amount } : null;
  }
  return nearestPointOnSegment(point, segment);
}

function directionPointOnSegment(point, segment, direction, anchor) {
  const [start, end] = segment, segmentDirection = { x: end.x - start.x, y: end.y - start.y }, epsilon = 1e-7;
  const cross = (first, second) => first.x * second.y - first.y * second.x;
  const denominator = cross(direction, segmentDirection), offset = { x: start.x - anchor.x, y: start.y - anchor.y };
  if (Math.abs(denominator) < epsilon) return Math.abs(cross(offset, direction)) < epsilon ? nearestPointOnSegment(point, segment) : null;
  const amount = cross(offset, direction) / denominator;
  if (amount < 0 || amount > 1) return null;
  const travel = cross(offset, segmentDirection) / denominator;
  return { point: { x: anchor.x + direction.x * travel, y: anchor.y + direction.y * travel }, amount };
}

export function snapPointToSegments(point, segments = [], tolerance = 8, options = {}) {
  let bestEndpoint = null, bestEdge = null;
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = options.direction&&options.anchor?directionPointOnSegment(point, segments[index],options.direction,options.anchor):axisPointOnSegment(point, segments[index], options.axis, options.anchor);
    if (!candidate) continue;
    const distance = Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y);
    const endpoint = candidate.amount <= 1e-7 || candidate.amount >= 1 - 1e-7;
    const result = { point: candidate.point, distance, segmentIndex: index, type: endpoint ? "endpoint" : "edge" };
    if (distance <= tolerance && endpoint && (!bestEndpoint || distance < bestEndpoint.distance)) bestEndpoint = result;
    if (distance <= tolerance && !endpoint && (!bestEdge || distance < bestEdge.distance)) bestEdge = result;

    if (!options.axis&&!options.direction) {
      for (const endpointPoint of segments[index]) {
        const endpointDistance = Math.hypot(point.x - endpointPoint.x, point.y - endpointPoint.y);
        if (endpointDistance <= tolerance && (!bestEndpoint || endpointDistance < bestEndpoint.distance)) bestEndpoint = { point: { ...endpointPoint }, distance: endpointDistance, segmentIndex: index, type: "endpoint" };
      }
    }
  }
  return bestEndpoint || bestEdge;
}

function multiplyMatrices(first, second) {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function applyMatrix(point, matrix) {
  return { x: point.x * matrix[0] + point.y * matrix[2] + matrix[4], y: point.x * matrix[1] + point.y * matrix[3] + matrix[5] };
}

export function extractVectorSegments(operatorList, ops, viewportTransform, maxSegments = 50000) {
  const segments = [], stack = [];
  const paintOps = new Set([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const closePaintOps = new Set([ops.closeStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  let transform = [1, 0, 0, 1, 0, 0], pending = [], current = null, start = null;
  const add = (first, last) => { if (pending.length + segments.length < maxSegments) pending.push([first, last]); };
  const transformed = point => applyMatrix(point, multiplyMatrices(viewportTransform, transform));
  const closePath = () => { if (current && start && (current.x !== start.x || current.y !== start.y)) add(transformed(current), transformed(start)); current = start ? { ...start } : current; };
  const curve = (first, control1, control2, last) => {
    let previous = first;
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8, inverse = 1 - t;
      const next = {
        x: inverse ** 3 * first.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * last.x,
        y: inverse ** 3 * first.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * last.y,
      };
      add(transformed(previous), transformed(next));previous = next;
    }
  };

  for (let index = 0; index < operatorList.fnArray.length && segments.length < maxSegments; index += 1) {
    const operation = operatorList.fnArray[index], args = operatorList.argsArray[index] || [];
    if (operation === ops.save) { stack.push(transform.slice());continue; }
    if (operation === ops.restore) { transform = stack.pop() || [1, 0, 0, 1, 0, 0];continue; }
    if (operation === ops.transform) { transform = multiplyMatrices(transform, args);continue; }
    if (operation === ops.constructPath) {
      const pathOps = args[0] || [], coordinates = args[1] || [];let offset = 0;
      for (const pathOp of pathOps) {
        if (pathOp === ops.rectangle) {
          const x = coordinates[offset++], y = coordinates[offset++], width = coordinates[offset++], height = coordinates[offset++];
          const corners = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
          for (let corner = 0; corner < 4; corner += 1) add(transformed(corners[corner]), transformed(corners[(corner + 1) % 4]));
          current = { ...corners[0] };start = { ...corners[0] };continue;
        }
        if (pathOp === ops.moveTo) { current = { x: coordinates[offset++], y: coordinates[offset++] };start = { ...current };continue; }
        if (pathOp === ops.lineTo) { const next = { x: coordinates[offset++], y: coordinates[offset++] };if (current) add(transformed(current), transformed(next));current = next;continue; }
        if (pathOp === ops.curveTo && current) {
          const first = { ...current }, control1 = { x: coordinates[offset++], y: coordinates[offset++] }, control2 = { x: coordinates[offset++], y: coordinates[offset++] }, last = { x: coordinates[offset++], y: coordinates[offset++] };
          curve(first, control1, control2, last);current = last;continue;
        }
        if (pathOp === ops.curveTo2 && current) {
          const first = { ...current }, control2 = { x: coordinates[offset++], y: coordinates[offset++] }, last = { x: coordinates[offset++], y: coordinates[offset++] };
          curve(first, first, control2, last);current = last;continue;
        }
        if (pathOp === ops.curveTo3 && current) {
          const first = { ...current }, control1 = { x: coordinates[offset++], y: coordinates[offset++] }, last = { x: coordinates[offset++], y: coordinates[offset++] };
          curve(first, control1, last, last);current = last;continue;
        }
        if (pathOp === ops.closePath) closePath();
      }
      continue;
    }
    if (paintOps.has(operation)) {
      if (closePaintOps.has(operation)) closePath();
      segments.push(...pending.slice(0, Math.max(0, maxSegments - segments.length)));pending = [];current = null;start = null;continue;
    }
    if (operation === ops.endPath) { pending = [];current = null;start = null; }
  }
  return segments;
}

export function measurementLineDash(lineType, factor = 1) {
  const patterns = {
    solid: [],
    dashed: [8, 5],
    dotted: [1.5, 4],
    centerline: [12, 4, 2, 4],
  };
  return (patterns[lineType] || patterns.solid).map(value => value * factor);
}

function cross(first, second) {
  return first.x * second.y - first.y * second.x;
}

function hatchForDirection(points, direction, spacing) {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const ray = { x: direction.x / length, y: direction.y / length };
  const normal = { x: -ray.y, y: ray.x };
  const offsets = points.map(point => point.x * normal.x + point.y * normal.y);
  const min = Math.min(...offsets), max = Math.max(...offsets), segments = [];
  const start = Math.floor(min / spacing) * spacing;
  for (let offset = start; offset <= max + spacing * 0.25; offset += spacing) {
    const origin = { x: normal.x * offset, y: normal.y * offset }, intersections = [];
    for (let index = 0; index < points.length; index++) {
      const first = points[index], last = points[(index + 1) % points.length];
      const edge = { x: last.x - first.x, y: last.y - first.y };
      const denominator = cross(ray, edge);
      if (Math.abs(denominator) < 1e-9) continue;
      const delta = { x: first.x - origin.x, y: first.y - origin.y };
      const along = cross(delta, edge) / denominator;
      const edgePosition = cross(delta, ray) / denominator;
      if (edgePosition >= -1e-9 && edgePosition < 1 - 1e-9) intersections.push({ along, point: { x: origin.x + ray.x * along, y: origin.y + ray.y * along } });
    }
    intersections.sort((first, last) => first.along - last.along);
    for (let index = 0; index + 1 < intersections.length; index += 2) segments.push([intersections[index].point, intersections[index + 1].point]);
  }
  return segments;
}

export function measurementHatchSegments(points, pattern, spacing = 8) {
  if (!Array.isArray(points) || points.length < 3 || !pattern || pattern === "none") return [];
  const directions = {
    diagonal: [{ x: 1, y: 1 }],
    crosshatch: [{ x: 1, y: 1 }, { x: 1, y: -1 }],
    horizontal: [{ x: 1, y: 0 }],
    vertical: [{ x: 0, y: 1 }],
  }[pattern] || [];
  return directions.flatMap(direction => hatchForDirection(points, direction, Math.max(2, spacing)));
}

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
    return ({ "0": "fit-width", "4": "layout-single", "5": "layout-continuous", "6": "layout-side", "7": "layout-continuous-side", "8": "actual-size", "9": "fit-page", o: "open", s: "export", y: "redo", z: "undo" })[key] || null;
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

export function calculateFitScale(pageSize, areaSize, layoutMode, fitMode) {
  if (fitMode === "actual") return 1;
  const columns = layoutMode === "side" || layoutMode === "continuous-side" ? 2 : 1;
  const width = Math.max(80, (areaSize.width - 72 - (columns - 1) * 24) / columns);
  const height = Math.max(80, areaSize.height - 72);
  const widthScale = width / (pageSize.width * 1.25);
  const heightScale = height / (pageSize.height * 1.25);
  const scale = fitMode === "width" ? widthScale : Math.min(widthScale, heightScale);
  return Math.max(0.25, Math.min(2, scale));
}

export function pageNumberLabel(descriptor, index) {
  const current = index + 1;
  if (descriptor?.blank) return `${current} · Inserted`;
  if (descriptor?.sourceIndex && descriptor.sourceIndex !== current) return `${current} · Original ${descriptor.sourceIndex}`;
  return String(current);
}

export function pointDistance(first, second) {
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function removeControlPoint(points = [], index, minimumPoints = 3) {
  if (!Array.isArray(points) || points.length <= minimumPoints || !Number.isInteger(index) || index < 0 || index >= points.length) return null;
  return points.filter((_, pointIndex) => pointIndex !== index).map(point => ({ ...point }));
}

export function polylineDistance(points = [], closed = false) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += pointDistance(points[index - 1], points[index]);
  if (closed && points.length > 2) total += pointDistance(points[points.length - 1], points[0]);
  return total;
}

export function polygonArea(points = []) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(sum) / 2;
}

export function angleDegrees(points = []) {
  if (points.length < 3) return 0;
  const [first, vertex, last] = points;
  const firstAngle = Math.atan2(first.y - vertex.y, first.x - vertex.x);
  const lastAngle = Math.atan2(last.y - vertex.y, last.x - vertex.x);
  let angle = Math.abs((lastAngle - firstAngle) * 180 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

export function calibrateDrawingScale(points, knownDistance, unit = "mm") {
  const rawDistance = pointDistance(points?.[0], points?.[1]);
  const distance = Number(knownDistance);
  if (!(rawDistance > 0) || !(distance > 0)) return null;
  return { unitsPerPoint: distance / rawDistance, unit };
}

export function measurementValue(kind, points = [], scale = { unitsPerPoint: 1, unit: "pt" }) {
  const multiplier = scale?.unitsPerPoint || 1;
  if (kind === "angle") return angleDegrees(points);
  if (kind === "count") return points.length;
  if (kind === "area") return polygonArea(points) * multiplier * multiplier;
  if (kind === "perimeter") return polylineDistance(points, true) * multiplier;
  if (kind === "polyline") return polylineDistance(points, false) * multiplier;
  return pointDistance(points[0], points[1]) * multiplier;
}

export function measurementPerimeterValue(kind, points = [], scale = { unitsPerPoint: 1, unit: "pt" }) {
  if (kind === "diameter") return Math.PI * pointDistance(points[0], points[1]) * (scale?.unitsPerPoint || 1);
  return measurementValue("perimeter", points, scale);
}

export function measurementFillBoundary(kind, points = [], segmentCount = 48) {
  if (kind !== "diameter") return points.map(point => ({ ...point }));
  if (points.length < 2) return [];
  const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  const radius = pointDistance(points[0], points[1]) / 2;
  return Array.from({ length: Math.max(12, segmentCount) }, (_, index) => {
    const angle = index / Math.max(12, segmentCount) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

export function formatMeasurement(kind, value, unit = "mm") {
  if (kind === "count") return String(Math.round(value));
  if (kind === "angle") return `${Math.round(value * 10) / 10}°`;
  const rounded = Math.round(value * 100) / 100;
  return kind === "area" ? `${rounded} ${unit}²` : `${rounded} ${unit}`;
}

export function measurementBounds(points = []) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
