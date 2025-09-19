#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');
const dataDir = join(root, 'src', 'data');

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('\nERROR: ' + msg + '\n'); process.exit(1); }

// Load schema v1 (others can be added later)
const schemaPath = join(dataDir, 'vocab_schema_v1.json');
let schema;
try {
  schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
} catch (e) {
  fail(`Unable to read schema: ${e.message}`);
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

// Collect vocab files
const vocabFiles = readdirSync(dataDir)
  .filter(f => /^vocab_.*\.json$/i.test(f) && !/schema/i.test(f));

if (vocabFiles.length === 0) {
  fail('No vocab_*.json files found to validate.');
}

let hadError = false;
const globalIds = new Set();

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
  const ok = validate(json);
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
  if (json?.categories) {
    for (const cat of json.categories) {
      for (const item of cat.items || []) {
        const composite = item.id;
        if (globalIds.has(composite)) {
          hadError = true;
          process.stderr.write(`Duplicate item id detected: ${composite} in file ${file}\n`);
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
