// تست رابط کاربری و تولیدکننده‌ها — اجرای واقعی اسکریپت داخل index.html روی داده‌های واقعی
// اجرا: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadApp, repoRoot } from './harness.mjs';

const CONFIGS = JSON.parse(readFileSync(path.join(repoRoot, 'json_configs/configs_1.json'), 'utf8')).configs;

function app(htmlPath) {
  return loadApp({ htmlPath });
}

/* عنصر را در صورت نبود می‌سازد — مثل getElementById واقعی */
const el = (a, id) => a.sandbox.document.getElementById(id);

function withInput(a, text) {
  el(a, 'inputLinks').value = text;
  a.sandbox.analyzeInput();
  return a;
}

/* ─────────────── پارسر روی داده واقعی ─────────────── */

test('همه ۱۹۱ کانفیگ واقعی بدون خطا پارس می‌شوند', () => {
  const a = withInput(app(), CONFIGS.join('\n'));
  const nodes = a.get('nodes');
  assert.equal(nodes.length, 191);
  assert.equal(a.get('invalidCount'), 0);
  assert.equal(el(a, 'statValid').textContent, '۱۹۱');
  assert.equal(el(a, 'statInvalid').textContent, '۰');
  assert.equal(nodes[0].proto, 'vless');
  assert.equal(nodes[0].address, 'zr-wasm.mahdijavid3700.workers.dev');
  assert.equal(nodes[0].port, 2096);
});

test('لینک تکراری به‌جای شمارش دوباره، در ستون «تکراری» می‌نشیند', () => {
  const a = withInput(app(), [CONFIGS[0], CONFIGS[0], CONFIGS[1]].join('\n'));
  assert.equal(a.get('nodes').length, 2);
  assert.equal(a.get('dupCount'), 1);
  assert.equal(el(a, 'statDup').textContent, '۱');
});

test('ورودی Base64 دکود می‌شود', () => {
  const encoded = Buffer.from(CONFIGS.slice(0, 3).join('\n'), 'utf8').toString('base64');
  const a = withInput(app(), encoded);
  assert.equal(a.get('nodes').length, 3);
});

test('لینک خراب به‌عنوان نامعتبر شمرده می‌شود و برنامه نمی‌شکند', () => {
  const a = withInput(app(), [CONFIGS[0], 'vmess://@@@not-base64@@@', 'ss://broken'].join('\n'));
  assert.equal(a.get('nodes').length, 1);
  assert.equal(a.get('invalidCount'), 2);
  assert.equal(el(a, 'statInvalid').textContent, '۲');
});

/* ─────────────── تشخیص کشور (باگ قبلی: AIR ← ایران) ─────────────── */

test('detectCountry فقط کد کشور مستقل را می‌گیرد', () => {
  const { sandbox } = app();
  const cases = {
    'AIR 01': '🌐',            // قبلاً 🇮🇷 می‌شد
    'Domain1-TLS': '🌐',       // قبلاً به‌خاطر «DOMA-IN» خطر داشت
    'FIRST 01': '🌐',
    'IR-01': '🇮🇷',
    'DE': '🇩🇪',
    'usa.visa.com': '🇺🇸',
    'CF_V3_africa.visa.com_8880': '🌐',   // قبلاً 🇫🇷
    'www.visaeurope.at': '🇦🇹',
    '🇯🇵 Tokyo': '🇯🇵',
    'iran-mci': '🇮🇷',
    'V2rayNG': '🌐',
    '': '🌐'
  };
  for (const [remark, expected] of Object.entries(cases)) {
    assert.equal(sandbox.detectCountry(remark), expected, 'remark: ' + remark);
  }
});

/* ─────────────── امنیت تزریق در رندر گره‌ها ─────────────── */

test('ریمارک مخرب به HTML تزریق نمی‌شود', () => {
  const evil = "vless://11111111-1111-1111-1111-111111111111@example.com:443?type=tcp&security=none#%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E%20it's";
  const a = withInput(app(), evil);
  const nodes = a.get('nodes');
  assert.equal(nodes.length, 1);
  assert.match(nodes[0].remark, /onerror/);

  const list = el(a, 'nodeList');
  list.innerHTML = '';
  a.sandbox.renderNodes();
  const card = list.children[0];
  assert.equal(card.tagName, 'ARTICLE');
  assert.equal(list.innerHTML, '', 'نباید هیچ innerHTML با داده کاربر نوشته شود');
  const title = card.children.find((c) => c._class === 'node-remark');
  assert.match(title.textContent, /onerror/);      // متن سالم، نه markup
  assert.equal(title.children.length, 0);
});

/* ─────────────── تولیدکننده Xray ─────────────── */

test('خروجی Xray معتبر است و کلیدها واقعاً اثر دارند', () => {
  const a = withInput(app(), CONFIGS.join('\n'));
  const list = a.get('nodes');
  const s = a.sandbox.getSettings();
  const cfg = JSON.parse(JSON.stringify(a.sandbox.buildXray(list, s)));

  assert.equal(cfg.outbounds.length, list.length + 2);       // گره‌ها + direct + block
  assert.equal(new Set(cfg.outbounds.map((o) => o.tag)).size, cfg.outbounds.length, 'تگ‌ها یکتا باشند');
  assert.equal(cfg.routing.balancers[0].selector[0], s.prefix);
  assert.ok(cfg.observatory, 'observatory باید روشن باشد');

  // باگ قبلی: کلید «مسدودسازی تبلیغات» در Xray هیچ اثری نداشت
  const rules = JSON.stringify(cfg.routing.rules);
  assert.match(rules, /category-ads-all/);
  // باگ قبلی: دامنه‌های ایرانی direct نمی‌شدند
  assert.match(rules, /geosite:ir/);
  // allowInsecure در realitySettings بی‌معنی بود
  assert.doesNotMatch(JSON.stringify(cfg), /"realitySettings":\{[^}]*allowInsecure/);
});

test('خاموش‌کردن کلیدها خروجی Xray را تغییر می‌دهد', () => {
  const a = withInput(app(), CONFIGS.slice(0, 5).join('\n'));
  const list = a.get('nodes');
  el(a, 'swAds').checked = false;
  el(a, 'swIR').checked = false;
  const cfg = a.sandbox.buildXray(list, a.sandbox.getSettings());
  const rules = JSON.stringify(cfg.routing.rules);
  assert.doesNotMatch(rules, /category-ads-all/);
  assert.doesNotMatch(rules, /geosite:ir/);
});

/* ─────────────── تولیدکننده Sing-Box ─────────────── */

test('Sing-Box عدد ثانیه می‌گیرد نه رشته «۳m» و rule_set تعریف می‌شود', () => {
  const a = withInput(app(), CONFIGS.join('\n'));
  const s = a.sandbox.getSettings();
  const cfg = JSON.parse(JSON.stringify(a.sandbox.buildSingBox(a.get('nodes'), s)));
  const urltest = cfg.outbounds.find((o) => o.type === 'urltest');

  assert.equal(typeof urltest.interval, 'number', 'interval باید عدد باشد');
  assert.ok(urltest.interval >= 60);
  assert.ok(Array.isArray(cfg.route.rule_set) && cfg.route.rule_set.length > 0, 'rule_set باید تعریف شود');
  for (const rule of cfg.route.rules) {
    if (!rule.rule_set) continue;
    const names = Array.isArray(rule.rule_set) ? rule.rule_set : [rule.rule_set];
    for (const n of names) {
      assert.ok(cfg.route.rule_set.some((rs) => rs.tag === n), 'rule_set «' + n + '» تعریف نشده');
    }
  }
});

test('intervalToSeconds واحدها را درست تبدیل می‌کند', () => {
  const { sandbox } = app();
  assert.equal(sandbox.intervalToSeconds('1m'), 60);
  assert.equal(sandbox.intervalToSeconds('3m'), 180);
  assert.equal(sandbox.intervalToSeconds('5m'), 300);
  assert.equal(sandbox.intervalToSeconds('2h'), 7200);
  assert.equal(sandbox.intervalToSeconds(''), 180);
});

/* ─────────────── تولیدکننده Clash ─────────────── */

test('Clash برای هر پروتکل کلید احراز هویت درست را می‌نویسد', () => {
  const a = app();
  const list = [
    { proto: 'trojan', address: 't.example.com', port: 443, uuid: 'tpass', network: 'tcp', security: 'tls', sni: 't.example.com', remark: 'trojan-node' },
    { proto: 'ss', address: 's.example.com', port: 8388, method: 'aes-256-gcm', uuid: 'spass', network: 'tcp', security: 'none', remark: 'ss-node' },
    { proto: 'vmess', address: 'v.example.com', port: 443, uuid: 'vuuid', network: 'ws', security: 'tls', sni: 'v.example.com', path: '/v', remark: 'vmess-node' }
  ];
  const out = a.sandbox.buildClash(list, a.sandbox.getSettings());

  const trojanBlock = out.slice(out.indexOf('- name: "proxy-1"'), out.indexOf('- name: "proxy-2"'));
  assert.match(trojanBlock, /password: "tpass"/, 'trojan باید password داشته باشد نه uuid');
  assert.doesNotMatch(trojanBlock, /uuid:/);

  const ssBlock = out.slice(out.indexOf('- name: "proxy-2"'), out.indexOf('- name: "proxy-3"'));
  assert.match(ssBlock, /cipher: "aes-256-gcm"/, 'ss باید cipher داشته باشد');
  assert.match(ssBlock, /password: "spass"/);

  const vmessBlock = out.slice(out.indexOf('- name: "proxy-3"'));
  assert.match(vmessBlock, /uuid: "vuuid"/);
  assert.match(vmessBlock, /alterId: 0/);

  assert.match(out, /interval: 180/, 'interval باید از تنظیمات بیاید');
});

/* ─────────────── رفتار رابط کاربری ─────────────── */

test('تغییر قالب خروجی کلیپ‌بورد را بازنویسی نمی‌کند', async () => {
  const a = withInput(app(), CONFIGS.slice(0, 4).join('\n'));
  a.sandbox.generate({ copy: true });
  await Promise.resolve();
  assert.equal(a.calls.copies.length, 1, 'فقط یک بار باید کپی شود');

  el(a, 'fmtSel').value = 'singbox';
  el(a, 'fmtSel').dispatch('change');
  await Promise.resolve();
  assert.equal(a.calls.copies.length, 1, 'تغییر قالب نباید کپی کند');
  assert.ok(a.get('textCache').singbox, 'خروجی singbox باید ساخته شود');
});

test('گره‌های لغو انتخاب‌شده وارد خروجی نمی‌شوند', () => {
  const a = withInput(app(), CONFIGS.slice(0, 5).join('\n'));
  const list = a.get('nodes');
  assert.equal(a.sandbox.selectedNodes().length, 5);

  a.sandbox.setNodeSelected(list[0], false);
  a.sandbox.setNodeSelected(list[1], false);
  assert.equal(a.sandbox.selectedNodes().length, 3);

  const cfg = a.sandbox.buildXray(a.sandbox.selectedNodes(), a.sandbox.getSettings());
  assert.equal(cfg.outbounds.length, 5);       // ۳ گره + direct + block
  assert.equal(el(a, 'finalCount').textContent, '۳');
});

test('خروجی بعد از تغییر گره‌ها «به‌روز نیست» علامت می‌خورد', () => {
  const a = withInput(app(), CONFIGS.slice(0, 3).join('\n'));
  a.sandbox.generate({});
  assert.equal(el(a, 'staleFlag').classList.contains('visible'), false);
  a.sandbox.removeNode(a.get('nodes')[0].id);
  assert.equal(el(a, 'staleFlag').classList.contains('visible'), true);
});

test('متن بلند برای QR صفحه‌بندی می‌شود', () => {
  const { sandbox } = app();
  const long = Array.from({ length: 40 }, (_, i) => 'vless://line-' + i + '-'.repeat(40)).join('\n');
  const pages = sandbox.splitForQr(long, 300);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((p) => p.length <= 300));
  assert.equal(pages.join('\n'), long);
});

test('بنر حافظه موقت با ورودی خالی نمایش داده نمی‌شود', () => {
  const a = app();
  assert.equal(el(a, 'tempFileStatus').classList.contains('visible'), false);
});

test('تم ذخیره‌شده بازیابی و روی <html> اعمال می‌شود', () => {
  const a = app();
  a.sandbox.applyTheme('theme-cyber');
  assert.equal(a.sandbox.document.documentElement.className, 'theme-cyber');
  assert.equal(a.storage.get('vx_theme'), 'theme-cyber');
  a.sandbox.applyTheme('theme-nonsense');
  assert.equal(a.sandbox.document.documentElement.className, 'theme-glass');
});

test('تولید بدون گره، پیام می‌دهد و نمی‌شکند', () => {
  const a = app();
  const out = a.sandbox.generate({ copy: true });
  assert.equal(out, '');
  assert.equal(a.calls.copies.length, 0);
});

/* ─────────────── بهینه‌سازی سرعت ─────────────── */

test('sockopt با کلیدهای معتبر Xray ساخته می‌شود', () => {
  const a = withInput(app(), CONFIGS.slice(0, 3).join('\n'));
  const cfg = a.sandbox.buildXray(a.get('nodes'), a.sandbox.getSettings());
  const so = cfg.outbounds[0].streamSettings.sockopt;
  assert.ok(so, 'sockopt باید وجود داشته باشد');
  assert.equal(so.tcpFastOpen, true);
  assert.equal(so.tcpMptcp, true);
  assert.equal(so.tcpKeepAliveIdle, 60);
  assert.equal(so.tcpKeepAliveInterval, 30);
  // کلیدی که در سورس Xray وجود ندارد نباید نوشته شود
  assert.equal(so.tcpNoDelay, undefined);
});

test('خاموش‌کردن کلیدها sockopt را حذف می‌کند', () => {
  const a = withInput(app(), CONFIGS.slice(0, 3).join('\n'));
  el(a, 'swTfo').checked = false;
  el(a, 'swMptcp').checked = false;
  el(a, 'swKeepAlive').checked = false;
  const cfg = a.sandbox.buildXray(a.get('nodes'), a.sandbox.getSettings());
  assert.equal(cfg.outbounds[0].streamSettings.sockopt, undefined);
});

test('bufferSize بر حسب کیلوبایت در policy می‌نشیند', () => {
  const a = withInput(app(), CONFIGS.slice(0, 2).join('\n'));
  el(a, 'bufferSel').value = '4096';
  let cfg = a.sandbox.buildXray(a.get('nodes'), a.sandbox.getSettings());
  assert.equal(cfg.policy.levels['8'].bufferSize, 4096);

  el(a, 'bufferSel').value = '0';
  cfg = a.sandbox.buildXray(a.get('nodes'), a.sandbox.getSettings());
  assert.equal(cfg.policy.levels['8'].bufferSize, undefined, 'در حالت پیش‌فرض نباید نوشته شود');
});

test('Clean IP جای address را می‌گیرد ولی SNI و Host دست‌نخورده می‌مانند', () => {
  const a = withInput(app(), CONFIGS.slice(0, 3).join('\n'));
  const nodes = a.get('nodes');
  const originalHost = nodes[0].address;

  el(a, 'cleanIp').value = '104.16.132.229';
  const s = a.sandbox.getSettings();
  assert.equal(s.perf.cleanIp, '104.16.132.229');

  const xray = a.sandbox.buildXray(nodes, s);
  assert.equal(xray.outbounds[0].settings.vnext[0].address, '104.16.132.229');
  assert.equal(xray.outbounds[0].streamSettings.wsSettings.headers.Host, originalHost);
  assert.notEqual(xray.outbounds[0].streamSettings.tlsSettings.serverName, '104.16.132.229');

  const sing = a.sandbox.buildSingBox(nodes, s);
  assert.equal(sing.outbounds[0].server, '104.16.132.229');
  assert.equal(sing.outbounds[0].tls.server_name, originalHost);
  assert.equal(sing.outbounds[0].tcp_fast_open, true);
  assert.equal(sing.outbounds[0].tcp_multi_path, true);

  const clash = a.sandbox.buildClash(nodes, s);
  assert.match(clash, /server: "104\.16\.132\.229"/);
  assert.match(clash, /servername: "zr-wasm\.mahdijavid3700\.workers\.dev"/);
  assert.match(clash, /tfo: true/);
  assert.match(clash, /mptcp: true/);
});

test('Clean IP نامعتبر رد می‌شود تا کانفیگ نشکند', () => {
  const { sandbox } = app();
  assert.equal(sandbox.normalizeCleanIp('104.16.132.229'), '104.16.132.229');
  assert.equal(sandbox.normalizeCleanIp('  1.2.3.4  '), '1.2.3.4');
  assert.equal(sandbox.normalizeCleanIp('2606:4700::1'), '2606:4700::1');
  assert.equal(sandbox.normalizeCleanIp('999.1.1.1'), '');
  assert.equal(sandbox.normalizeCleanIp('example.com'), '');
  assert.equal(sandbox.normalizeCleanIp('<script>'), '');
  assert.equal(sandbox.normalizeCleanIp(''), '');
});

test('گره‌های سریع‌تر بر پایه تأخیر سنجیده‌شده انتخاب می‌شوند', () => {
  const a = withInput(app(), CONFIGS.slice(0, 6).join('\n'));
  const list = a.get('nodes');
  const map = a.get('latencyMap');
  const nodeKeyFn = a.get('nodeKey');

  // سه میزبان با تأخیر متفاوت
  map.set(nodeKeyFn(list[0]), { state: 'ok', ms: 320 });
  map.set(nodeKeyFn(list[1]), { state: 'ok', ms: 90 });
  map.set(nodeKeyFn(list[2]), { state: 'ok', ms: 210 });
  map.set(nodeKeyFn(list[3]), { state: 'timeout', ms: null });

  const best = a.sandbox.fastestNodes(2);
  assert.equal(best.length, 2);
  assert.equal(best[0].raw, list[1].raw, 'کم‌تأخیرترین باید اول باشد');
  assert.equal(best[1].raw, list[2].raw);

  a.sandbox.selectFastest(2);
  assert.equal(a.sandbox.selectedNodes().length, 2);
  assert.equal(el(a, 'finalCount').textContent, '۲');
});

test('گره بدون TLS از صفحه HTTPS قابل سنجش نیست', () => {
  const a = app();
  const isTlsFn = a.get('isTlsNode');
  const canProbeFn = a.get('canProbe');
  const tlsNode = { address: 'a.example', port: 2096, security: 'tls' };
  const plainNode = { address: 'b.example', port: 8880, security: 'none' };
  assert.equal(isTlsFn(tlsNode), true);
  assert.equal(canProbeFn(tlsNode), true);
  // هارنس روی https اجرا می‌شود
  assert.equal(canProbeFn(plainNode), false);
});

test('early data از path خوانده می‌شود و دست‌نخورده می‌ماند', () => {
  const withEd = CONFIGS.find((c) => c.includes('ed%3D') || c.includes('ed='));
  assert.ok(withEd, 'داده واقعی باید گره دارای ed داشته باشد');
  const a = withInput(app(), withEd);
  const nodes = a.get('nodes');
  assert.equal(nodes.length, 1);
  const cfg = a.sandbox.buildXray(nodes, a.sandbox.getSettings());
  // Xray خودش ?ed= را از path می‌خواند؛ ما نباید path را تغییر دهیم
  assert.match(cfg.outbounds[0].streamSettings.wsSettings.path, /ed=\d+/);
});
