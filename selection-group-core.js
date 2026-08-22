function pageKey(item) {
  return String(item?.pageId || item?.page || "");
}

function validGroupId(item) {
  return typeof item?.groupId === "string" && item.groupId.trim() ? item.groupId : "";
}

function groupKey(item) {
  const groupId = validGroupId(item);
  return groupId ? `${pageKey(item)}\u0000${groupId}` : "";
}

function uniqueIds(ids = []) {
  return [...new Set(ids.filter(id => typeof id === "string" && id))];
}

export function groupedMemberIds(items = [], id) {
  const item = items.find(candidate => candidate.id === id);
  if (!item) return [];
  const key = groupKey(item);
  return key ? items.filter(candidate => groupKey(candidate) === key).map(candidate => candidate.id) : [item.id];
}

export function expandGroupedSelectionIds(items = [], ids = []) {
  const selected = uniqueIds(ids), result = [...selected], included = new Set(selected);
  const groupKeys = new Set(selected.map(id => groupKey(items.find(item => item.id === id))).filter(Boolean));
  for (const item of items) {
    if (!included.has(item.id) && groupKeys.has(groupKey(item))) {
      result.push(item.id);
      included.add(item.id);
    }
  }
  return result;
}

export function toggleGroupedSelectionIds(items = [], currentIds = [], targetId) {
  const current = new Set(expandGroupedSelectionIds(items, currentIds)), members = groupedMemberIds(items, targetId);
  if (!members.length) return [...current];
  const remove = members.every(id => current.has(id));
  for (const id of members) remove ? current.delete(id) : current.add(id);
  return expandGroupedSelectionIds(items, [...current]);
}

export function toggleGroupedSelectionMatches(items = [], currentIds = [], matchedIds = []) {
  let result = expandGroupedSelectionIds(items, currentIds);
  const units = new Map();
  for (const id of uniqueIds(matchedIds)) {
    const item = items.find(candidate => candidate.id === id);
    if (!item) continue;
    const key = groupKey(item) || `item\u0000${item.id}`;
    if (!units.has(key)) units.set(key, item.id);
  }
  for (const id of units.values()) result = toggleGroupedSelectionIds(items, result, id);
  return result;
}

export function applyGroupedSelectionMode(items = [], currentIds = [], matchedIds = [], mode = "replace") {
  const current = expandGroupedSelectionIds(items, currentIds), matched = expandGroupedSelectionIds(items, matchedIds);
  if (mode === "add") return expandGroupedSelectionIds(items, [...current, ...matched]);
  if (mode === "remove") {
    const removed = new Set(matched);
    return current.filter(id => !removed.has(id));
  }
  return matched;
}

export function selectionGroupInfo(items = [], ids = []) {
  const selectedIds = expandGroupedSelectionIds(items, ids), selected = selectedIds.map(id => items.find(item => item.id === id)).filter(Boolean);
  const keys = [...new Set(selected.map(groupKey).filter(Boolean))], firstKey = selected.length ? groupKey(selected[0]) : "";
  return {
    selectedIds,
    groupCount: keys.length,
    groupedItemCount: selected.filter(item => Boolean(groupKey(item))).length,
    isSingleGroup: selected.length > 1 && Boolean(firstKey) && selected.every(item => groupKey(item) === firstKey),
    canGroup: selected.length > 1 && !(Boolean(firstKey) && selected.every(item => groupKey(item) === firstKey)),
    canUngroup: keys.length > 0,
  };
}

export function groupSelectedItems(items = [], ids = [], groupId) {
  const selectedIds = expandGroupedSelectionIds(items, ids), selected = selectedIds.map(id => items.find(item => item.id === id)).filter(Boolean);
  const pages = new Set(selected.map(pageKey));
  if (selected.length < 2 || pages.size !== 1 || typeof groupId !== "string" || !groupId.trim()) return [];
  for (const item of selected) item.groupId = groupId;
  return selected.map(item => item.id);
}

export function ungroupSelectedItems(items = [], ids = []) {
  const selected = new Set(expandGroupedSelectionIds(items, ids)), keys = new Set();
  for (const item of items) if (selected.has(item.id) && groupKey(item)) keys.add(groupKey(item));
  const changedIds = [];
  for (const item of items) {
    if (!keys.has(groupKey(item))) continue;
    delete item.groupId;
    changedIds.push(item.id);
  }
  return changedIds;
}
