#!/usr/bin/env node

/**
 * WF2 Test Script
 * Simulates what the n8n workflow will do:
 * 1. Read test data
 * 2. Call form server for each company
 * 3. Track results
 * 4. Report status
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Test data
const testData = [
  { company: 'Test Company A', website: 'https://example.com', status: '未送信' },
  { company: 'Test Company B', website: 'https://example.org', status: '未送信' },
  { company: 'Formspree Test', website: 'https://formspree.io', status: '未送信' }
];

const FORM_SERVER = 'http://localhost:3456';
const OUTREACH_MESSAGE = `Hello,

My name is Jayden Barnes, VP of Growth at MGC Inc. — we help Japanese manufacturers and suppliers expand their overseas sales using AI-powered outreach and marketing.

I'm reaching out because your company imports from Japan, and I believe we have a partnership opportunity that could create additional value for both of our businesses.

Would you be open to a 15-minute call to explore this further?

Best regards,
Jayden Barnes
VP of Growth — MGC Inc.
jayden.barnes@mgc-global01.com
+81-80-6197-2569`;

async function testFormServer(company, website) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      url: website,
      company_name: company,
      message: OUTREACH_MESSAGE
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
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            company,
            website,
            statusCode: res.statusCode,
            ...parsed
          });
        } catch (e) {
          resolve({
            company,
            website,
            statusCode: res.statusCode,
            error: 'Failed to parse response',
            raw: data
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        company,
        website,
        error: error.message,
        statusCode: 0
      });
    });

    req.write(payload);
    req.end();
  });
}

async function checkServerHealth() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3456,
      path: '/health',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runTest() {
  console.log('\n🚀 WF2 Integration Test\n');
  console.log('Form Server Status:');

  // Check server health first
  try {
    const health = await checkServerHealth();
    console.log(`✅ Server online — Mode: ${health.mode}\n`);
  } catch (e) {
    console.error(`❌ Server not responding: ${e.message}`);
    process.exit(1);
  }

  console.log('Testing companies:\n');

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (const test of testData) {
    process.stdout.write(`  • ${test.company} ... `);
    const result = await testFormServer(test.company, test.website);
    results.push(result);

    if (result.statusCode === 200 && result.success) {
      console.log(`✅ Form found (${result.fieldsFilled} fields filled)`);
      successCount++;
    } else if (result.statusCode === 200) {
      console.log(`⚠️  No form found`);
      failureCount++;
    } else {
      console.log(`❌ Error: ${result.error || result.statusCode}`);
      failureCount++;
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  // Report
  console.log(`\n📊 Test Results:\n`);
  console.log(`  Total: ${testData.length}`);
  console.log(`  Success: ${successCount} (forms found & filled)`);
  console.log(`  Failed: ${failureCount} (no form or error)`);
  console.log(`  Success Rate: ${((successCount / testData.length) * 100).toFixed(1)}%\n`);

  // Save results
  const resultsFile = path.join(__dirname, `results/wf2-test-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`📄 Results saved to: ${resultsFile}\n`);

  // Status update simulation
  console.log('Google Sheets status update (simulated):\n');
  results.forEach(r => {
    const status = r.success ? '送信済み' : r.error ? '失敗' : '検出なし';
    console.log(`  ${r.company.padEnd(20)} → ${status}`);
  });

  console.log('\n✅ Test complete! Ready for WF2 activation.\n');
}

runTest().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
