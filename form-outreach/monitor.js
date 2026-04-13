#!/usr/bin/env node
/**
 * Real-time monitoring of form outreach batch results
 * Usage: node monitor.js
 */

const fs = require('fs');
const path = require('path');

const resultsFile = '/Users/jayden.csai/clawd/form-outreach/results/batch_2026-04-12.json';
let lastSize = 0;

console.clear();
console.log('📊 Form Outreach Batch Monitor\n');
console.log(`Watching: ${path.basename(resultsFile)}`);
console.log(`Updated: ${new Date().toLocaleTimeString()}\n`);

setInterval(() => {
  if (!fs.existsSync(resultsFile)) return;

  try {
    const data = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    const results = data.results || [];
    const summary = data.summary || { total: 0, success: 0, errors: 0 };

    // Categorize
    const success = results.filter(r => r.fieldsFilled > 0 && r.status === 'ok').length;
    const filled = results.filter(r => r.fieldsFilled > 0).length;
    const noform = results.filter(r => r.fieldsFilled === 0 && r.status === 'failed').length;
    const errors = results.filter(r => r.error).length;

    const rate = results.length > 0 ? (filled / results.length * 100).toFixed(1) : 0;
    const timestamp = new Date().toLocaleTimeString();

    // Only update if changed
    if (results.length !== lastSize) {
      console.clear();
      console.log(`📊 Form Outreach Batch Monitor — ${timestamp}\n`);
      console.log(`Processed: ${results.length} companies`);
      console.log(`Forms found: ${filled} (${rate}%)`);
      console.log(`  ✅ Success: ${success}`);
      console.log(`  ⚠️  No form: ${noform}`);
      console.log(`  ❌ Errors: ${errors}\n`);

      // Show recent successes
      const recentSuccess = results
        .filter(r => r.fieldsFilled > 0 && r.status === 'ok')
        .slice(-3);

      if (recentSuccess.length > 0) {
        console.log('📍 Recent successes:');
        recentSuccess.forEach(r => {
          console.log(`  • ${r.company} (${r.fieldsFilled} fields)`);
        });
        console.log();
      }

      // Show recent errors
      const recentErrors = results
        .filter(r => r.error)
        .slice(-2);

      if (recentErrors.length > 0) {
        console.log('⚠️  Recent errors:');
        recentErrors.forEach(r => {
          const err = r.error.slice(0, 60);
          console.log(`  • ${r.company}: ${err}${r.error.length > 60 ? '...' : ''}`);
        });
        console.log();
      }

      console.log('(Updating every 2 seconds...)');
      lastSize = results.length;
    }
  } catch (e) {
    // File not ready yet
  }
}, 2000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n✅ Monitor stopped');
  process.exit(0);
});
