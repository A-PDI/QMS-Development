'use strict';
/**
 * Create the certificate e-sign uses to seal completed PDFs.
 *
 *   node scripts/esign-generate-cert.js <output.p12> [--name "Performance Diesel Inc."] [--years 5]
 *
 * Prompts for nothing: the passphrase is read from ESIGN_P12_PASSPHRASE (set it
 * first), so the same value ends up in server/.env. Then set
 *   ESIGN_P12_PATH=<output.p12>
 *
 * This is a SELF-SIGNED certificate. The seal still proves the file has not
 * changed since signing (Acrobat shows "signature is valid, document has not
 * been modified"), but Acrobat also says the signer's identity is unknown
 * until the certificate is trusted on that PC — or until you replace this
 * file with a document-signing certificate bought from a trusted CA.
 */

const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const out = process.argv[2];
  if (!out || out.startsWith('--')) {
    console.error('Usage: node scripts/esign-generate-cert.js <output.p12> [--name "Org"] [--years 5]');
    process.exit(1);
  }
  const passphrase = process.env.ESIGN_P12_PASSPHRASE || '';
  if (passphrase.length < 12) {
    console.error('Set ESIGN_P12_PASSPHRASE (12+ characters) before running this script.');
    process.exit(1);
  }
  if (fs.existsSync(out)) {
    console.error(`${out} already exists — refusing to overwrite it.`);
    process.exit(1);
  }
  const org = arg('--name', 'Performance Diesel Inc.');
  const years = Math.max(1, parseInt(arg('--years', '5'), 10) || 5);

  console.log('Generating a 3072-bit RSA key (this takes a few seconds)…');
  const keys = forge.pki.rsa.generateKeyPair(3072);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + years);
  const attrs = [
    { name: 'commonName', value: `${org} e-Sign Seal` },
    { name: 'organizationName', value: org },
    { name: 'countryName', value: 'US' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  const der = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, der, { mode: 0o600 });

  console.log(`Wrote ${path.resolve(out)}`);
  console.log(`Valid until ${cert.validity.notAfter.toISOString().slice(0, 10)}.`);
  console.log('Add to server/.env:');
  console.log(`  ESIGN_P12_PATH=${path.resolve(out)}`);
  console.log('  ESIGN_P12_PASSPHRASE=<the passphrase you set>');
}

main();
