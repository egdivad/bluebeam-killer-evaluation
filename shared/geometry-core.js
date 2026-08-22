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

export function pointDistance(first, second) {
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function removeControlPoint(points = [], index, minimumPoints = 3) {
  if (!Array.isArray(points) || points.length <= minimumPoints || !Number.isInteger(index) || index < 0 || index >= points.length) return null;
  return points.filter((_, pointIndex) => pointIndex !== index).map(point => ({ ...point }));
}
