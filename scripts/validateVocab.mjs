#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');
const dataDir = join(root, 'src', 'data');

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('\nERROR: ' + msg + '\n'); process.exit(1); }

// Load schemas v1 and v2
function loadJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { fail(`Unable to read ${p}: ${e.message}`); }
}
const schemaV1 = loadJson(join(dataDir, 'vocab_schema_v1.json'));
const schemaV2 = loadJson(join(dataDir, 'vocab_schema_v2.json'));

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv); // enable date-time format used by generatedAt
const validateV1 = ajv.compile(schemaV1);
const validateV2 = ajv.compile(schemaV2);

// Collect vocab files
const vocabFiles = readdirSync(dataDir)
  .filter(f => /^vocab_.*\.json$/i.test(f) && !/schema/i.test(f));

if (vocabFiles.length === 0) {
  fail('No vocab_*.json files found to validate.');
}

let hadError = false;
const globalIds = new Set(); // track language+id composite

for (const file of vocabFiles) {
  const full = join(dataDir, file);
  let json;
  try {
    json = JSON.parse(readFileSync(full, 'utf8'));
  } catch (e) {
    hadError = true;
    process.stderr.write(`\nFile ${file} is not valid JSON: ${e.message}`);
    continue;
  }
  // Choose schema: default v1 unless root schemaVersion === 2
  const schemaVersion = json && typeof json.schemaVersion === 'number' ? json.schemaVersion : 1;
  const validate = schemaVersion === 2 ? validateV2 : validateV1;
  // Validate a clone without the helper field to respect additionalProperties:false
  const toValidate = JSON.parse(JSON.stringify(json));
  if (Object.prototype.hasOwnProperty.call(toValidate, 'schemaVersion')) delete toValidate.schemaVersion;
  const ok = validate(toValidate);
  if (!ok) {
    hadError = true;
    process.stderr.write(`\nSchema errors in ${file}:\n`);
    for (const err of validate.errors || []) {
      process.stderr.write(` - ${err.instancePath || '(root)'} ${err.message}\n`);
    }
  } else {
    log(`✔ ${file} schema valid`);
  }
  // Duplicate ID check across categories
  if (toValidate?.categories) {
    for (const cat of toValidate.categories) {
      for (const item of cat.items || []) {
        const composite = `${json.language || '??'}::${item.id}`;
        if (globalIds.has(composite)) {
          hadError = true;
          process.stderr.write(`Duplicate item id detected (same language & id): ${composite} in file ${file}\n`);
        } else {
          globalIds.add(composite);
        }
      }
    }
  }
}

if (hadError) {
  fail('Validation failed.');
} else {
  log('\nAll vocabulary files validated successfully.');
}
