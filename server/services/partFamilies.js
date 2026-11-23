'use strict';
/**
 * Product families of part numbers, and copying dimensional specifications
 * from one part number to others in its family.
 *
 * Family membership
 * -----------------
 * 1. An explicit Product Family set on a part (part_specs.product_family) is
 *    authoritative: parts are in the same family when that value matches.
 * 2. Otherwise the family is derived from the part description with its
 *    variant marker removed. "C15 Cylinder Head — Stage 1" and
 *    "C15 Cylinder Head Stage 2" share the family "C15 CYLINDER HEAD"; the
 *    ISX heads share "CUMMINS ISX CYLINDER HEAD". Everything else in the
 *    description — engine model, component, any other identifier — has to
 *    match exactly, so similar-sounding parts are never grouped.
 * In both cases a family member must also be the same component type.
 *
 * To recognise a new kind of variant (another stage naming, a "Rev" suffix,
 * …), add a pattern to VARIANT_PATTERNS.
 */

// Patterns matched against the normalized description (upper case, words
// separated by single spaces, punctuation removed).
const VARIANT_PATTERNS = [
  /\bSTAGE ?(?:\d+|[IVX]+|ONE|TWO|THREE|FOUR|FIVE|SIX)\b/g,
  /\bSTG ?\d+\b/g,
];

// Spellings that name the same thing. Only unambiguous abbreviations.
const SYNONYMS = [
  [/\bCATERPILLAR\b/g, 'CAT'],
  [/\bCYL\b/g, 'CYLINDER'],
];

/** Upper case, punctuation removed, single-spaced, synonyms applied. */
function normalizeText(text) {
  let s = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, replacement] of SYNONYMS) s = s.replace(re, replacement);
  return s;
}

/** The variant markers in a description, e.g. ['STAGE 2']. */
function variantsOf(description) {
  const s = normalizeText(description);
  const found = [];
  for (const re of VARIANT_PATTERNS) {
    for (const m of s.match(re) || []) found.push(m);
  }
  return found;
}

/** The description with variant markers removed — the derived family name. */
function baseDescription(description) {
  let s = normalizeText(description);
  for (const re of VARIANT_PATTERNS) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** { key, explicit } identifying a part's family, or null when it has none. */
function familyKey(part) {
  const explicit = normalizeText(part?.product_family);
  if (explicit) return { key: `family:${explicit}`, explicit: true, name: explicit };
  const base = baseDescription(part?.description);
  if (!base) return null;
  return { key: `description:${base}`, explicit: false, name: base };
}

const sameComponent = (a, b) =>
  String(a?.component_type ?? '').trim().toLowerCase() === String(b?.component_type ?? '').trim().toLowerCase();

/**
 * Other parts in the source part's family, in part-number order.
 * `parts` are rows with id, part_number, description, product_family and
 * component_type (from the part's inspection form).
 */
function findFamilyCandidates(source, parts) {
  const key = familyKey(source);
  if (!key || !String(source?.component_type ?? '').trim()) return [];
  return (parts || [])
    .filter(p => p && p.id !== source.id && sameComponent(p, source))
    .filter(p => familyKey(p)?.key === key.key)
    .sort((a, b) => String(a.part_number).localeCompare(String(b.part_number)));
}

const normLabel = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Work out what copying a part's specs to each target would do, without
 * changing anything.
 *
 *   rules          — the shared dimensional rules module
 *   sourceSections — the source part's form sections
 *   sourceSpecData — the source part's spec_data
 *   targets        — [{ part, sections }]: each target part with its form sections
 *
 * Points are matched by their stable key (section key + item id) and must
 * also be the same kind of section with the same measurement name on the
 * target form; a point the target form lacks, or defines differently, is
 * skipped and reported instead of being associated with the wrong point.
 *
 * Returns one plan per target:
 *   { id, part_number, description, form_no,
 *     apply:     points the target has no spec for          (will be set)
 *     conflicts: points the target already specifies differently (kept unless replace is confirmed)
 *     unchanged: points the target already specifies the same
 *     skipped:   points that cannot be mapped, with a reason }
 */
function planPropagation(rules, { sourceSections, sourceSpecData, targets }) {
  const sourcePoints = rules.listDimensionalPoints(sourceSections).points
    .filter(p => !rules.isSpecEmpty(sourceSpecData?.[p.key]));

  return (targets || []).map(({ part, sections }) => {
    const targetPoints = new Map(rules.listDimensionalPoints(sections).points.map(p => [p.key, p]));
    const existing = part.spec_data && typeof part.spec_data === 'object' ? part.spec_data : {};
    const plan = {
      id: part.id,
      part_number: part.part_number,
      description: part.description || '',
      form_no: part.form_no || '',
      apply: [], conflicts: [], unchanged: [], skipped: [],
    };
    for (const point of sourcePoints) {
      const value = sourceSpecData[point.key];
      const entry = {
        key: point.key,
        label: point.label,
        section_title: point.sectionTitle,
        new_text: rules.specDisplayText(value),
      };
      const target = targetPoints.get(point.key);
      if (!target) {
        plan.skipped.push({ ...entry, reason: 'missing_point', detail: 'This inspection point is not on the part\'s inspection form.' });
        continue;
      }
      if (target.sectionType !== point.sectionType || normLabel(target.label) !== normLabel(point.label)) {
        plan.skipped.push({
          ...entry,
          reason: 'incompatible_point',
          detail: `The part's form defines this point as "${target.label}" (${target.sectionType}).`,
        });
        continue;
      }
      const current = existing[point.key];
      if (rules.isSpecEmpty(current)) plan.apply.push({ ...entry, value });
      else if (rules.specsEqual(current, value)) plan.unchanged.push(entry);
      else plan.conflicts.push({ ...entry, value, existing_text: rules.specDisplayText(current) });
    }
    return plan;
  });
}

/** The target's new spec_data for a plan; conflicts only replaced when confirmed. */
function applyPlan(existingSpecData, plan, replaceConflicts) {
  const next = { ...(existingSpecData && typeof existingSpecData === 'object' ? existingSpecData : {}) };
  for (const entry of plan.apply) next[entry.key] = entry.value;
  if (replaceConflicts) for (const entry of plan.conflicts) next[entry.key] = entry.value;
  return next;
}

module.exports = {
  VARIANT_PATTERNS,
  normalizeText,
  variantsOf,
  baseDescription,
  familyKey,
  findFamilyCandidates,
  planPropagation,
  applyPlan,
};
