// ثبت خروجی: همان ورودی واقعی روی نسخه‌ی مشخصی از index.html
// استفاده: node tests/baseline.mjs <out.json> [htmlPath]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadApp, repoRoot } from './harness.mjs';

const outFile = process.argv[2] || '/tmp/baseline.json';
const htmlPath = process.argv[3] || path.join(repoRoot, 'index.html');
const configs = JSON.parse(readFileSync(path.join(repoRoot, 'json_configs/configs_1.json'), 'utf8')).configs;

const { sandbox, get, registry } = loadApp({ htmlPath });
registry.get('inputLinks').value = configs.join('\n');
sandbox.analyzeInput();

const nodes = get('nodes');
const settings = sandbox.getSettings();
const out = {
  nodes: nodes.length,
  invalid: get('invalidCount'),
  flags: nodes.map((n) => n.flag),
  statLines: registry.get('statLines').textContent,
  xray: JSON.stringify(sandbox.buildXray(nodes, settings), null, 2),
  singbox: JSON.stringify(sandbox.buildSingBox(nodes, settings), null, 2),
  clash: sandbox.buildClash(nodes, settings)
};
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log('nodes:', out.nodes, 'invalid:', out.invalid, 'flags:', [...new Set(out.flags)].join(' '));
