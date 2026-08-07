'use strict';
/**
 * Fake CarbonZapp bench payloads for tests.
 *
 * Mirrors the shape of server/db/samples/carbonzapp_sample.json but small
 * enough to reason about: two IVM flow steps plus the internal FL(W) step.
 */

/**
 * One bench report object (= one injector in one slot).
 *
 * @param {Object} opts
 *   id        report _id (injectors sharing an _id belong to one test report)
 *   slot      slot position
 *   serial    injector serial number
 *   job       job number (must start with "QMS" to be imported)
 *   part      part number
 *   flow      { IVM01, IVM06 } measured averages (null = no reading at all)
 *   errorOn   step code to attach a bench error to, e.g. 'IVM06'
 *   errorText raw API error description
 */
function benchReport({
  id = 'rep-1',
  slot = 0,
  serial = 'SN001',
  job = 'QMS-724-3',
  part = '6513589PX',
  datetime = '2026-06-30T13:40:56+00:00',
  flow = {},
  errorOn = null,
  errorText = 'HP ERROR (out of range) #1000',
} = {}) {
  const stepName = (code, label) => (errorOn === code ? `${label} : ${errorText}` : label);
  const tank = (value, min, max, target) => ({
    tank_name: '',
    tank_unit: 'mm3/STRK',
    text_green: `${target} +/- ${((max - min) / 2).toFixed(1)}`,
    min_green: String(min),
    max_green: String(max),
    target_blue: String(target),
    tol_blue: String(((max - min) / 2).toFixed(1)),
    // null / undefined = the bench recorded no reading for this tank.
    AvrResult: value == null ? '' : String(value),
    results: value == null ? '' : String(value),
  });

  return {
    _id: id,
    actuator_code: part,
    actuator_Brand: 'Cummins',
    actuator_type: 'XPI-CRIN',
    machine_name: 'ITB.4r-X [S]',
    machine_sn: '012605532',
    datetime,
    status: 6,
    job,
    SlotsData: { position: slot, sn: serial },
    AllTests: [
      {
        TestInfo: { test_name: 'FL(W) : SKIPPED', test_order: 0, status: 1 },
        PrimaryTank: null,
        SecondaryTank: null,
      },
      {
        TestInfo: { test_name: stepName('IVM01', 'iVM.01'), test_order: 1, status: 4, hp: '1600', inj_1: '750' },
        PrimaryTank: tank(flow.IVM01 !== undefined ? flow.IVM01 : 230, 220, 240, 230),
        SecondaryTank: null,
      },
      {
        TestInfo: { test_name: stepName('IVM06', 'iVM.06'), test_order: 2, status: 4, hp: '1800', inj_1: '1200' },
        PrimaryTank: tank(flow.IVM06 !== undefined ? flow.IVM06 : 260, 234, 276, 255),
        SecondaryTank: null,
      },
    ],
  };
}

/** A batch of `count` injectors spread over `perReport` slots per test report. */
function benchBatch(count, opts = {}) {
  const { perReport = 4, job = 'QMS-724-3', part = '6513589PX', prefix = 'SN' } = opts;
  // Report ids must be unique per batch: injectors are deduped on
  // (report_ext_id, slot_position), so two batches sharing ids would overwrite
  // each other.
  const idPrefix = opts.idPrefix || `rep-${prefix}`;
  const reports = [];
  for (let i = 0; i < count; i += 1) {
    reports.push(benchReport({
      id: `${idPrefix}-${Math.floor(i / perReport) + 1}`,
      slot: i % perReport,
      serial: `${prefix}${String(i + 1).padStart(3, '0')}`,
      job,
      part,
      ...(typeof opts.customise === 'function' ? opts.customise(i) : {}),
    }));
  }
  return reports;
}

module.exports = { benchReport, benchBatch };
