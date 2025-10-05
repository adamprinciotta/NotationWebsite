// src/validation/comboSchemaV1.js
export const ALLOWED_DIRS = new Set(["n","u","d","f","b","uf","ub","df","db"]);

function isIsoDate(s) {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && s.includes("T") && s.endsWith("Z");
}

function isNonEmptyString(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function validateEvent(evt, idx, path, errs) {
  if (typeof evt !== "object" || evt === null) {
    errs.push(`${path}[${idx}] must be an object`);
    return;
  }
  const { id, t, chip, dir, hold = false, duration = 0, notes = "" } = evt;

  if (!isNonEmptyString(id)) errs.push(`${path}[${idx}].id must be a non-empty string`);
  if (!Number.isInteger(t) || t < 0) errs.push(`${path}[${idx}].t must be an integer >= 0`);
  if (!isNonEmptyString(chip)) errs.push(`${path}[${idx}].chip must be a non-empty string`);
  if (!ALLOWED_DIRS.has(dir)) errs.push(`${path}[${idx}].dir must be one of ${[...ALLOWED_DIRS].join(", ")}`);
  if (typeof hold !== "boolean") errs.push(`${path}[${idx}].hold must be boolean`);
  if (!Number.isInteger(duration) || duration < 0) errs.push(`${path}[${idx}].duration must be an integer >= 0`);
  if (typeof notes !== "string") errs.push(`${path}[${idx}].notes must be a string`);
}

function validateTimeline(tl, path, errs) {
  if (!Array.isArray(tl) || tl.length === 0) {
    errs.push(`${path} must be a non-empty array`);
    return;
  }
  tl.forEach((evt, i) => validateEvent(evt, i, path, errs));
  // check sort by t
  for (let i = 1; i < tl.length; i++) {
    if (tl[i].t < tl[i-1].t) {
      errs.push(`${path} must be sorted by t ascending (found t at index ${i} < index ${i-1})`);
      break;
    }
  }
  // id uniqueness within this sequence
  const ids = tl.map(e => e.id);
  if (ids.length !== uniq(ids).length) {
    errs.push(`${path} contains duplicate event id(s)`);
  }
}

export function validateComboV1(json) {
  const errs = [];
  if (typeof json !== "object" || json === null) {
    return { ok: false, errs: ["Root must be an object"] };
  }

  const { version, kind, meta, profileId, timeline, branches = [] } = json;

  if (version !== "1.0.0") errs.push(`version must be "1.0.0"`);
  if (kind !== "combo") errs.push(`kind must be "combo"`);

  // meta block (optional but recommended)
  if (meta !== undefined) {
  if (typeof meta !== "object" || meta === null) errs.push(`meta must be an object`);
  else {
    const {
      game, character, title, author,
      createdAt, updatedAt, tags
    } = meta;
    if (game !== undefined && !isNonEmptyString(game)) errs.push(`meta.game must be non-empty string`);
    if (character !== undefined && !isNonEmptyString(character)) errs.push(`meta.character must be non-empty string`);
    if (title !== undefined && !isNonEmptyString(title)) errs.push(`meta.title must be non-empty string`);
    if (author !== undefined && !isNonEmptyString(author)) errs.push(`meta.author must be non-empty string`);
    if (createdAt !== undefined && !isIsoDate(createdAt)) errs.push(`meta.createdAt must be ISO UTC (e.g., 2025-10-02T00:00:00.000Z)`);
    if (updatedAt !== undefined && !isIsoDate(updatedAt)) errs.push(`meta.updatedAt must be ISO UTC`);
    if (tags !== undefined) {
      if (!Array.isArray(tags)) errs.push(`meta.tags must be an array`);
      else if (!tags.every(t => typeof t === "string")) errs.push(`meta.tags must contain only strings`);
    }
  }
}

  if (profileId !== undefined && !isNonEmptyString(profileId)) {
    errs.push(`profileId must be a non-empty string`);
  }

  validateTimeline(timeline, "timeline", errs);

  if (!Array.isArray(branches)) errs.push(`branches must be an array`);
  else {
    branches.forEach((br, i) => {
      if (typeof br !== "object" || br === null) {
        errs.push(`branches[${i}] must be an object`);
        return;
      }
      const { fromEventId, label, timeline: btl } = br;
      if (!isNonEmptyString(fromEventId)) errs.push(`branches[${i}].fromEventId must be non-empty string`);
      if (!isNonEmptyString(label)) errs.push(`branches[${i}].label must be non-empty string`);
      validateTimeline(btl, `branches[${i}].timeline`, errs);
      // sanity: fromEventId must exist in root timeline
      if (Array.isArray(timeline) && !timeline.some(e => e.id === fromEventId)) {
        errs.push(`branches[${i}].fromEventId does not exist in root timeline`);
      }
    });
  }

  return { ok: errs.length === 0, errs };
}

