export function normalizePageRotation(value = 0) {
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) return 0;
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0;
}

export function makePageGeometry({ x = 0, y = 0, width, height, rotation = 0 } = {}) {
  const pageWidth = Number(width);
  const pageHeight = Number(height);
  if (!Number.isFinite(pageWidth) || pageWidth <= 0 || !Number.isFinite(pageHeight) || pageHeight <= 0) {
    throw new TypeError("Page geometry needs a positive width and height.");
  }
  return {
    x: Number.isFinite(Number(x)) ? Number(x) : 0,
    y: Number.isFinite(Number(y)) ? Number(y) : 0,
    width: pageWidth,
    height: pageHeight,
    rotation: normalizePageRotation(rotation),
  };
}

export function displayPageSize(geometry) {
  const page = makePageGeometry(geometry);
  return page.rotation === 90 || page.rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

export function displayPointToPdf(point, geometry) {
  const page = makePageGeometry(geometry);
  const displayX = Number(point?.x) || 0;
  const displayY = Number(point?.y) || 0;
  if (page.rotation === 90) return { x: page.x + displayY, y: page.y + displayX };
  if (page.rotation === 180) return { x: page.x + page.width - displayX, y: page.y + displayY };
  if (page.rotation === 270) return { x: page.x + page.width - displayY, y: page.y + page.height - displayX };
  return { x: page.x + displayX, y: page.y + page.height - displayY };
}

export function pdfPointToDisplay(point, geometry) {
  const page = makePageGeometry(geometry);
  const pdfX = (Number(point?.x) || 0) - page.x;
  const pdfY = (Number(point?.y) || 0) - page.y;
  if (page.rotation === 90) return { x: pdfY, y: pdfX };
  if (page.rotation === 180) return { x: page.width - pdfX, y: pdfY };
  if (page.rotation === 270) return { x: page.height - pdfY, y: page.width - pdfX };
  return { x: pdfX, y: page.height - pdfY };
}

export function displayRectToPdfRect(rect, geometry, padding = 0) {
  const pad = Math.max(0, Number(padding) || 0);
  const left = Number(rect?.x) - pad;
  const top = Number(rect?.y) - pad;
  const right = Number(rect?.x) + Number(rect?.w) + pad;
  const bottom = Number(rect?.y) + Number(rect?.h) + pad;
  const points = [
    displayPointToPdf({ x: left, y: top }, geometry),
    displayPointToPdf({ x: right, y: top }, geometry),
    displayPointToPdf({ x: right, y: bottom }, geometry),
    displayPointToPdf({ x: left, y: bottom }, geometry),
  ];
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function displayBoundsToPdfRect(points, geometry, padding = 0) {
  if (!Array.isArray(points) || !points.length) return [0, 0, 0, 0];
  const xs = points.map(point => Number(point.x) || 0);
  const ys = points.map(point => Number(point.y) || 0);
  return displayRectToPdfRect({
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }, geometry, padding);
}

export function limitedCanvasPixelRatio(width, height, requestedRatio = 1, maxPixels = 16_000_000) {
  const cssWidth = Math.max(1, Number(width) || 1);
  const cssHeight = Math.max(1, Number(height) || 1);
  const requested = Math.max(.5, Number(requestedRatio) || 1);
  const limit = Math.max(1, Number(maxPixels) || 16_000_000);
  return Math.min(requested, Math.max(.5, Math.sqrt(limit / (cssWidth * cssHeight))));
}
