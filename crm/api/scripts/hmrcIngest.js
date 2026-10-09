// Load or refresh Diane's HMRC & CIS knowledge from GOV.UK into the database
// in .env (the clone). node scripts/hmrcIngest.js [--guides-only]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const knowledge = require('../v1/agent/hmrc/knowledge');

(async () => {
  const t0 = Date.now();
  const out = await knowledge.refresh({
    manualsToo: !process.argv.includes('--guides-only'),
    onProgress: (p) => process.stdout.write(`${JSON.stringify(p)}\n`),
  });
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`, out, `≈ $${((out.embedTokens / 1e6) * 0.02).toFixed(3)} of embeddings`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
