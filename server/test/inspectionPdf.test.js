'use strict';
/**
 * Inspection PDF content rules:
 *  - Section A items marked N/A are left out of the report.
 *  - Every Fire Ring spec flagged for entry gets its own per-cylinder row.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { tmpDir, extractPdfText } = require('./helpers/testEnv');
const { generateInspectionPdf } = require('../services/pdf');

const RECEIVING = {
  title: 'A. RECEIVING & DOCUMENTATION VERIFICATION',
  section_type: 'pfn_checklist',
  items: [
    { id: 1, name: 'Outer Carton Condition', requirement: 'Carton undamaged' },
    { id: 2, name: 'Box Package Label', requirement: 'Label present' },
    { id: 3, name: 'Part Marking', requirement: 'Part number marked' },
  ],
};

const FIRE_RING = {
  title: 'C. DIMENSIONAL INSPECTION - Fire Ring',
  section_type: 'groove_specs',
  cylinder_count: 6,
  items: [
    { id: 1, measurement: 'Groove Diameter', spec: '6.300 in', entry: true },
    { id: 2, measurement: 'Groove Depth', spec: '.029-.031', entry: true },
    { id: 3, measurement: 'Wire Protrusion', spec: '.008-.010', entry: true },
  ],
};

const inspection = (sectionData) => ({
  form_no: 'PDI-IQI-005',
  part_number: '1234567',
  po_number: 'PO-1',
  inspector_name: 'Test User',
  section_data: sectionData,
});

const template = (sections) => ({ title: 'Cylinder Head', form_no: 'PDI-IQI-005', sections });

/** One flat string of everything drawn in the document. */
async function pdfText(inspectionRow, templateRow, attachments = []) {
  const buffer = await generateInspectionPdf(inspectionRow, templateRow, attachments);
  return extractPdfText(buffer).join(' ');
}

/** A 1x1 PNG on disk, standing in for an inspector's photo. */
function testImage(name) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  ));
  return file;
}

test('Section A items marked N/A are left out of the report', async () => {
  const text = await pdfText(
    inspection({
      receiving: [
        { id: 1, status: 'P', finding: '' },
        { id: 2, status: 'N', finding: 'no label on a bulk crate' },
        { id: 3, status: 'F', finding: 'marking illegible' },
      ],
    }),
    template({ receiving: RECEIVING })
  );

  assert.ok(text.includes('Outer Carton Condition'), 'a passing item is reported');
  assert.ok(text.includes('Part Marking'), 'a failing item is reported');
  assert.ok(!text.includes('Box Package Label'), 'the N/A item is not reported');
  assert.ok(!text.includes('no label on a bulk crate'), 'nor is its finding');
});

test('a Section A with every item N/A is dropped from the report', async () => {
  const text = await pdfText(
    inspection({
      receiving: [
        { id: 1, status: 'N', finding: '' },
        { id: 2, status: 'N', finding: '' },
        { id: 3, status: 'N', finding: '' },
      ],
    }),
    template({ receiving: RECEIVING })
  );

  assert.ok(!text.includes('RECEIVING & DOCUMENTATION'), 'the section header is gone too');
  assert.ok(!text.includes('Outer Carton Condition'));
});

test('an unanswered Section A item is still reported', async () => {
  const text = await pdfText(
    inspection({ receiving: [{ id: 1, status: '', finding: '' }, { id: 2, status: 'P', finding: '' }] }),
    template({ receiving: RECEIVING })
  );

  assert.ok(text.includes('Outer Carton Condition'), 'no status is not the same as N/A');
});

test('every Fire Ring spec flagged for entry gets its own measured row', async () => {
  const text = await pdfText(
    inspection({
      fire_ring: {
        measurements: [
          { id: 1, cylinders: ['6.301', '6.300', '', '', '', ''], status: 'P', notes: '' },
          { id: 2, cylinders: ['.030', '', '', '', '', ''], status: 'P', notes: '' },
          { id: 3, cylinders: ['.009', '', '', '', '', ''], status: 'P', notes: '' },
        ],
      },
    }),
    template({ fire_ring: FIRE_RING })
  );

  assert.ok(text.includes('Groove Diameter'), 'Groove Diameter has a row');
  assert.ok(text.includes('Groove Depth'), 'Groove Depth has a row');
  assert.ok(text.includes('Wire Protrusion'));
  assert.ok(text.includes('6.301') && text.includes('.030') && text.includes('.009'),
    'the measured values are printed');
  assert.ok(!text.includes('Specifications'),
    'no reference-only spec is left, so the spec header is dropped');
});

test('a Fire Ring spec with no chart of its own stays in the header', async () => {
  const sections = {
    fire_ring: {
      ...FIRE_RING,
      items: [
        { id: 1, measurement: 'Groove Diameter', spec: '6.300 in', entry: false },
        { id: 3, measurement: 'Wire Protrusion', spec: '.008-.010', entry: true },
      ],
    },
  };
  const text = await pdfText(
    inspection({ fire_ring: { measurements: [{ id: 3, cylinders: ['.009', '', '', '', '', ''], status: 'P' }] } }),
    template(sections)
  );

  assert.ok(text.includes('Specifications'), 'the reference block is still drawn');
  assert.ok(text.includes('Groove Diameter'));
  assert.ok(text.includes('Wire Protrusion'));
});

test('a photo attached to an N/A item is dropped along with the item', async () => {
  const attachments = [
    { id: 'a1', section_key: 'receiving', item_id: 2, mime_type: 'image/png', file_name: 'na.png', file_path: testImage('na.png') },
  ];
  const build = (status) => generateInspectionPdf(
    inspection({
      receiving: [
        { id: 1, status: 'P', finding: '' },
        { id: 2, status, finding: '' },
        { id: 3, status: 'P', finding: '' },
      ],
    }),
    template({ receiving: RECEIVING }),
    attachments
  );
  // Every page carries the PDI logo, so count embedded images rather than
  // looking for any image at all.
  const images = (buffer) => (buffer.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;

  const [reported, notApplicable] = await Promise.all([build('P'), build('N')]);
  assert.ok(images(reported) > images(notApplicable),
    "the N/A item's photo is left out while a reported item's photo is embedded");
});
