#!/usr/bin/env node
/**
 * Analyze form outreach batch results
 * Usage: node analyze-results.js [results-file.json]
 */

const fs = require('fs');
const path = require('path');

const resultsFile = process.argv[2] || '/Users/jayden.csai/clawd/form-outreach/results/batch_2026-04-12.json';

if (!fs.existsSync(resultsFile)) {
  console.error(`❌ Results file not found: ${resultsFile}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const results = data.results || [];

console.log(`\n📊 FORM OUTREACH BATCH ANALYSIS\n`);
console.log(`Results file: ${path.basename(resultsFile)}`);
console.log(`Total companies processed: ${results.length}\n`);

// ─── Categorize Results ────────────────────────────────────────────────────
const categories = {
  success: { count: 0, items: [] },
  partial: { count: 0, items: [] },
  noform: { count: 0, items: [] },
  error: { count: 0, items: [] },
};

results.forEach(r => {
  if (r.status === 'ok' && r.fieldsFilled > 0) {
    categories.success.count++;
    categories.success.items.push(r);
  } else if (r.status === 'failed' && r.fieldsFilled > 0) {
    categories.partial.count++;
    categories.partial.items.push(r);
  } else if (r.status === 'failed' && r.fieldsFilled === 0) {
    categories.noform.count++;
    categories.noform.items.push(r);
  } else {
    categories.error.count++;
    categories.error.items.push(r);
  }
});

// ─── Summary Statistics ────────────────────────────────────────────────────
const totalSuccess = categories.success.count;
const totalPartial = categories.partial.count;
const totalNoForm = categories.noform.count;
const totalError = categories.error.count;
const successRate = results.length > 0 ? (totalSuccess / results.length * 100).toFixed(1) : 0;

console.log(`✅ SUCCESS (forms filled): ${totalSuccess} (${successRate}%)`);
console.log(`📝 PARTIAL (filled but flag issues): ${totalPartial}`);
console.log(`❌ NO FORM FOUND: ${totalNoForm}`);
console.log(`⚠️  ERRORS: ${totalError}\n`);

// ─── Success Details ──────────────────────────────────────────────────────
if (categories.success.count > 0) {
  console.log(`🎯 SUCCESSFUL COMPANIES (Workable Forms):\n`);
  categories.success.items.forEach((item, i) => {
    console.log(`${i + 1}. ${item.company}`);
    console.log(`   Website: ${item.website}`);
    console.log(`   Form URL: ${item.formUrl}`);
    console.log(`   Fields filled: ${item.fieldsFilled}`);
    console.log(`   ${item.note || 'Ready for live submission'}\n`);
  });
}

// ─── Partial Details (had issues but filled some fields) ───────────────────
if (categories.partial.count > 0) {
  console.log(`\n📋 PARTIAL MATCHES:\n`);
  categories.partial.items.slice(0, 10).forEach((item, i) => {
    console.log(`${i + 1}. ${item.company} (${item.fieldsFilled} fields)`);
    console.log(`   Issue: ${item.note || 'Unknown'}\n`);
  });
}

// ─── No Form Found ────────────────────────────────────────────────────────
if (categories.noform.count > 0) {
  console.log(`\n🔍 NO CONTACT FORM DETECTED (${categories.noform.count} companies):\n`);
  categories.noform.items.slice(0, 10).forEach((item, i) => {
    console.log(`${i + 1}. ${item.company}`);
    const note = item.note || 'Form detection failed';
    console.log(`   ${note.slice(0, 80)}`);
  });
  if (categories.noform.count > 10) {
    console.log(`\n   ... and ${categories.noform.count - 10} more`);
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────
if (categories.error.count > 0) {
  console.log(`\n⚠️  ERRORS (${categories.error.count} companies):\n`);
  const errorTypes = {};
  categories.error.items.forEach(item => {
    const errMsg = item.error || 'Unknown error';
    if (!errorTypes[errMsg]) errorTypes[errMsg] = [];
    errorTypes[errMsg].push(item.company);
  });
  Object.entries(errorTypes).slice(0, 5).forEach(([err, companies]) => {
    console.log(`${err}`);
    console.log(`  Companies: ${companies.slice(0, 3).join(', ')}${companies.length > 3 ? ' ...' : ''}`);
    console.log();
  });
}

// ─── High-Confidence Whitelist ────────────────────────────────────────────
console.log(`\n✨ RECOMMENDED WHITELIST FOR LIVE TESTING:\n`);
console.log(`These ${categories.success.count} companies have confirmed workable contact forms:\n`);
categories.success.items.forEach((item, i) => {
  console.log(`${i + 1}. ${item.company} (${item.fieldsFilled} fields)`);
});

if (categories.success.count === 0) {
  console.log(`\n⚠️  No companies with confirmed forms yet.`);
  console.log(`   Need to complete batch processing or increase sample size.\n`);
}

// ─── CSV Export ───────────────────────────────────────────────────────────
const whitelistCSV = categories.success.items
  .map(item => `"${item.company}","${item.website}","${item.formUrl}","${item.fieldsFilled}"`)
  .join('\n');

const whitelistPath = path.join(
  path.dirname(resultsFile),
  `whitelist_${path.basename(resultsFile, '.json')}.csv`
);

fs.writeFileSync(
  whitelistPath,
  `Company Name,Website,Form URL,Fields Detected\n${whitelistCSV}`
);

console.log(`\n✅ Whitelist saved to: ${whitelistPath}`);
console.log(`\nNext step: Review whitelist, then run with LIVE_MODE=true on these companies.\n`);
