#!/usr/bin/env node

/**
 * Simple WF2 Test — Verify form server integration
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const testCases = [
  { name: 'Test Company A', url: 'https://example.com' },
  { name: 'Test Company B', url: 'https://example.org' },
  { name: 'Mutual Trading', url: 'https://www.mutualtrading.com' }
];

const MESSAGE = 'Hello,\n\nMy name is Jayden Barnes, VP of Growth at MGC Inc. — we help Japanese manufacturers expand overseas.\n\nI\'m reaching out because I believe we have a partnership opportunity that could create value for both of us.\n\nWould you be open to a 15-minute call?\n\nBest regards,\nJayden Barnes\nVP of Growth — MGC Inc.';

function makeRequest(company, url) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      url,
      company_name: company,
      message: MESSAGE
    });

    const options = {
      hostname: 'localhost',
      port: 3456,
      path: '/submit-form',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve({ company, url, statusCode: res.statusCode, ...result });
        } catch (e) {
          resolve({ company, url, statusCode: res.statusCode, error: 'Parse error', raw: data });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ company, url, statusCode: 0, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('\n📋 WF2 Form Server Integration Test\n');

  // Check health
  try {
    const health = await new Promise((resolve) => {
      const req = http.request(
        { hostname: 'localhost', port: 3456, path: '/health', method: 'GET' },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => { resolve(JSON.parse(data)); });
        }
      );
      req.on('error', () => resolve(null));
      req.end();
    });

    if (!health) {
      console.error('❌ Form server not running on localhost:3456');
      process.exit(1);
    }

    console.log(`✅ Form server running — Mode: ${health.mode}\n`);
  } catch (e) {
    console.error('❌ Error checking health:', e.message);
    process.exit(1);
  }

  // Run tests
  console.log('Testing companies:\n');
  const results = [];
  let success = 0, failed = 0;

  for (const test of testCases) {
    process.stdout.write(`  • ${test.name.padEnd(20)} ... `);
    const result = await makeRequest(test.name, test.url);
    results.push(result);

    if (result.statusCode === 200) {
      if (result.success || result.fieldsFilled > 0) {
        console.log(`✅ FOUND (${result.fieldsFilled} fields)`);
        success++;
      } else {
        console.log(`⚠️  NO FORM`);
        failed++;
      }
    } else {
      console.log(`❌ ERROR (${result.error || result.statusCode})`);
      failed++;
    }
  }

  // Summary
  console.log(`\n📊 Results:\n`);
  console.log(`  Total: ${testCases.length}`);
  console.log(`  Forms Found: ${success}`);
  console.log(`  Not Found/Error: ${failed}`);
  console.log(`  Success Rate: ${((success / testCases.length) * 100).toFixed(1)}%\n`);

  // Save results
  const date = new Date().toISOString().split('T')[0];
  const resultsFile = path.join(__dirname, `results/wf2-test-${date}.json`);
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`📄 Results saved: ${resultsFile}\n`);

  // Show what WF2 will do
  console.log('Expected Google Sheets updates:\n');
  results.forEach((r) => {
    const status = r.success || r.fieldsFilled > 0 ? '送信済み' : '失敗';
    console.log(`  ${r.company.padEnd(20)} → ${status}`);
  });

  console.log('\n✅ Integration test complete!\n');
}

main().catch(console.error);
