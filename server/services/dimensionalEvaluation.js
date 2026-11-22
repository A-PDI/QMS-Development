'use strict';
/**
 * Server side of automatic dimensional Pass/Fail evaluation.
 *
 * The rules themselves live in /shared/dimensionalSpec.mjs, which the client
 * imports too, so the server judges a measurement exactly as the inspection
 * form displayed it. That file is an ES module; this CommonJS service loads it
 * once with import() (supported on every Node 22 release this app runs on).
 */

const path = require('path');
const { pathToFileURL } = require('url');
const db = require('../db/adapter');

const RULES_PATH = path.join(__dirname, '..', '..', 'shared', 'dimensionalSpec.mjs');

let rulesPromise = null;

/** The shared rules module (cached after the first load). */
function loadRules() {
  if (!rulesPromise) {
    rulesPromise = import(pathToFileURL(RULES_PATH).href).catch((err) => {
      rulesPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return rulesPromise;
}

// Statuses in which an inspection is still being filled in. Anything else is a
// closed record whose recorded results must not be re-judged.
const EDITABLE_STATUSES = new Set(['draft', 'partially_complete']);

function parseJson(text, fallback) {
  if (text && typeof text === 'object') return text;
  try { return JSON.parse(text || ''); } catch (_) { return fallback; }
}

/**
 * The part_specs row for a template + part number: an exact match first, then
 * a case- and whitespace-insensitive one (part numbers are typed by hand).
 */
function findPartSpec(templateId, partNumber) {
  const pn = String(partNumber ?? '').trim();
  if (!templateId || !pn) return null;
  const row = db.get('SELECT * FROM part_specs WHERE template_id = ? AND part_number = ?', [templateId, pn])
    || db.get(
      'SELECT * FROM part_specs WHERE template_id = ? AND UPPER(TRIM(part_number)) = UPPER(?) ORDER BY updated_at DESC LIMIT 1',
      [templateId, pn]
    );
  if (!row) return null;
  return { ...row, spec_data: parseJson(row.spec_data, {}) };
}

/** Template sections for an inspection's template, or {}. */
function templateSectionsFor(templateId) {
  const t = db.get('SELECT sections FROM inspection_templates WHERE id = ?', [templateId]);
  return t ? parseJson(t.sections, {}) : {};
}

/**
 * Apply automatic evaluation to section_data that is about to be stored.
 *
 *   inspection   — the stored inspection row (template_id, part_number,
 *                  status, section_data)
 *   sectionData  — the incoming section_data object
 *   partNumber   — the part number in force after this save
 *
 * An inspection being filled in is fully re-evaluated against the current
 * spec. A closed one (e.g. Fire Ring values added after completion) only has
 * the points whose readings changed evaluated, so recorded results stay as
 * they were recorded.
 *
 * Returns { sectionData, changed, invalid }.
 */
async function evaluateForSave({ inspection, sectionData, partNumber }) {
  const rules = await loadRules();
  const partSpec = findPartSpec(inspection.template_id, partNumber ?? inspection.part_number);
  const editable = EDITABLE_STATUSES.has(inspection.status);
  return rules.evaluateSectionData(sectionData, {
    templateSections: templateSectionsFor(inspection.template_id),
    partSpecData: partSpec ? partSpec.spec_data : null,
    previous: parseJson(inspection.section_data, {}),
    onlyChanged: !editable,
  });
}

/** Short description of invalid readings for an error message. */
function describeInvalid(invalid, itemCount) {
  const labels = invalid.map((entry) => {
    const item = itemCount > 1 ? `Item ${entry.itemIndex + 1} — ` : '';
    return `${item}${entry.label}`;
  });
  const unique = [...new Set(labels)];
  const shown = unique.slice(0, 3).join('; ');
  return unique.length > 3 ? `${shown} (+${unique.length - 3} more)` : shown;
}

module.exports = {
  loadRules,
  findPartSpec,
  templateSectionsFor,
  evaluateForSave,
  describeInvalid,
  EDITABLE_STATUSES,
};
