import base64
import json
import math
import os
import urllib.request
from urllib.parse import parse_qs, unquote, urlparse


def fetch_and_decode(url):
    """دریافت و دکود کردن محتوای لینک ساب"""
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            content = response.read().decode('utf-8').strip()
            try:
                decoded = base64.b64decode(content).decode('utf-8')
                return decoded.splitlines()
            except Exception:
                return content.splitlines()
    except Exception as e:
        print(f'Error fetching {url}: {e}')
        return []


def parse_vless_to_outbound(vless_url, tag_name):
    """تبدیل لینک vless:// به آبجکت outbound در Xray"""
    try:
        parsed = urlparse(vless_url)
        if parsed.scheme != 'vless':
            return None

        uuid = parsed.username
        address = parsed.hostname
        port = parsed.port or 443
        params = parse_qs(parsed.query)

        network = params.get('type', ['tcp'])[0]
        security = params.get('security', ['none'])[0]
        path = unquote(params.get('path', ['/'])[0])
        host = params.get('host', [''])[0]
        sni = params.get('sni', [''])[0]
        fp = params.get('fp', ['chrome'])[0]
        alpn_raw = params.get('alpn', [''])[0]
        alpn = alpn_raw.split(',') if alpn_raw else []

        outbound = {
            'mux': {'concurrency': -1, 'enabled': False},
            'protocol': 'vless',
            'settings': {
                'vnext': [
                    {
                        'address': address,
                        'port': int(port),
                        'users': [{'encryption': 'none', 'id': uuid, 'level': 8}],
                    }
                ]
            },
            'streamSettings': {'network': network},
            'tag': tag_name,
        }

        # تنظیمات Stream
        if network == 'ws':
            ws_settings = {'headers': {}}
            if host:
                ws_settings['headers']['Host'] = host
            if path:
                ws_settings['path'] = path
            outbound['streamSettings']['wsSettings'] = ws_settings

        # تنظیمات TLS
        if security == 'tls':
            outbound['streamSettings']['security'] = 'tls'
            tls_settings = {'allowInsecure': False, 'show': False}
            if sni:
                tls_settings['serverName'] = sni
            if fp:
                tls_settings['fingerprint'] = fp
            if alpn:
                tls_settings['alpn'] = alpn
            outbound['streamSettings']['tlsSettings'] = tls_settings

        return outbound
    except Exception as e:
        print(f'Error parsing link {vless_url}: {e}')
        return None


def generate_full_json_config(outbound_proxies):
    """تولید ساختار کامل JSON نهایی"""
    base_config = {
        'dns': {
            'hosts': {
                'domain:googleapis.cn': 'googleapis.com',
                'dns.alidns.com': [
                    '223.5.5.5',
                    '223.6.6.6',
                    '2400:3200::1',
                    '2400:3200:baba::1',
                ],
                'one.one.one.one': [
                    '1.1.1.1',
                    '1.0.0.1',
                    '2606:4700:4700::1111',
                    '2606:4700:4700::1001',
                ],
                'dns.cloudflare.com': [
                    '104.16.132.229',
                    '104.16.133.229',
                    '2606:4700::6810:84e5',
                    '2606:4700::6810:85e5',
                ],
                'dns.google': [
                    '8.8.8.8',
                    '8.8.4.4',
                    '2001:4860:4860::8888',
                    '2001:4860:4860::8844',
                ],
            },
            'servers': [
                '1.1.1.1',
                {'address': '1.1.1.1', 'domains': ['geosite:google']},
                {
                    'address': '223.5.5.5',
                    'domains': [
                        'domain:alidns.com',
                        'domain:doh.pub',
                        'domain:dot.pub',
                        'geosite:cn',
                    ],
                    'expectIPs': ['geoip:cn'],
                    'skipFallback': True,
                    'tag': 'domestic-dns',
                },
            ],
            'tag': 'dns-module',
        },
        'inbounds': [
            {
                'listen': '127.0.0.1',
                'port': 10808,
                'protocol': 'socks',
                'settings': {'auth': 'noauth', 'udp': True, 'userLevel': 8},
                'sniffing': {
                    'destOverride': ['http', 'tls'],
                    'enabled': True,
                    'routeOnly': False,
                },
                'tag': 'socks',
            }
        ],
        'log': {'loglevel': 'warning'},
        'observatory': {
            'enableConcurrency': True,
            'probeInterval': '3m',
            'probeUrl': 'https://www.gstatic.com/generate_204',
            'subjectSelector': ['proxy-'],
        },
        'outbounds': [],
        'policy': {
            'levels': {
                '8': {
                    'connIdle': 300,
                    'downlinkOnly': 1,
                    'handshake': 4,
                    'uplinkOnly': 1,
                }
            },
            'system': {
                'statsOutboundDownlink': True,
                'statsOutboundUplink': True,
            },
        },
        'remarks': 'javidsub Intelligent Selection',
        'routing': {
            'balancers': [
                {
                    'selector': ['proxy-'],
                    'strategy': {'type': 'leastPing'},
                    'tag': 'proxy-round',
                }
            ],
            'domainStrategy': 'AsIs',
            'rules': [
                {
                    'network': 'udp',
                    'outboundTag': 'block',
                    'port': '443',
                    'type': 'field',
                },
                {
                    'balancerTag': 'proxy-round',
                    'domain': ['geosite:google'],
                    'type': 'field',
                },
                {
                    'ip': ['geoip:private'],
                    'outboundTag': 'direct',
                    'type': 'field',
                },
                {
                    'domain': ['geosite:private'],
                    'outboundTag': 'direct',
                    'type': 'field',
                },
                {
                    'ip': ['geoip:cn'],
                    'outboundTag': 'direct',
                    'type': 'field',
                },
                {
                    'domain': ['geosite:cn'],
                    'outboundTag': 'direct',
                    'type': 'field',
                },
                {
                    'inboundTag': ['domestic-dns'],
                    'outboundTag': 'direct',
                    'type': 'field',
                },
                {
                    'balancerTag': 'proxy-round',
                    'inboundTag': ['dns-module'],
                    'type': 'field',
                },
                {
                    'balancerTag': 'proxy-round',
                    'network': 'tcp,udp',
                    'type': 'field',
                },
            ],
        },
        'stats': {},
    }

    # افزودن تمام پروکسی‌ها به خروجی‌ها
    base_config['outbounds'].extend(outbound_proxies)

    # افزودن Direct و Block در انتهای لیست Outbounds
    base_config['outbounds'].append(
        {
            'protocol': 'freedom',
            'settings': {'domainStrategy': 'UseIP'},
            'tag': 'direct',
        }
    )
    base_config['outbounds'].append(
        {
            'protocol': 'blackhole',
            'settings': {'response': {'type': 'http'}},
            'tag': 'block',
        }
    )

    return base_config


def main():
    raw_urls = os.environ.get('SUB_URLS', '')
    urls = [u.strip() for u in raw_urls.splitlines() if u.strip()]

    if not urls:
        print('No URLs found in SUB_URLS secret!')
        return

    all_raw_configs = []

    # ۱. دریافت تمام لینک‌ها
    for url in urls:
        lines = fetch_and_decode(url)
        for line in lines:
            line = line.strip()
            if line.startswith('vless://') and line not in all_raw_configs:
                all_raw_configs.append(line)

    print(f'Total valid VLESS configs found: {len(all_raw_configs)}')

    # ۲. ذخیره فایل خام متنی javidsub
    with open('javidsub', 'w', encoding='utf-8') as f:
        f.write('\n'.join(all_raw_configs))

    # ۳. ذخیره بسته‌های ۱۰۰۰ تایی
    chunk_size = 1000
    total_chunks = math.ceil(len(all_raw_configs) / chunk_size)
    os.makedirs('json_configs', exist_ok=True)

    for i in range(total_chunks):
        chunk = all_raw_configs[i * chunk_size : (i + 1) * chunk_size]
        json_data = {
            'chunk_index': i + 1,
            'total_configs': len(chunk),
            'configs': chunk,
        }
        with open(
            f'json_configs/configs_{i + 1}.json', 'w', encoding='utf-8'
        ) as f:
            json.dump(json_data, f, ensure_ascii=False, indent=2)

    # ۴. تبدیل لینک‌ها به Outbound برای فایل JSON نهایی
    parsed_outbounds = []
    for idx, link in enumerate(all_raw_configs, start=1):
        outbound = parse_vless_to_outbound(link, tag_name=f'proxy-{idx}')
        if outbound:
            parsed_outbounds.append(outbound)

    # ۵. ساخت ساختار کامل JSON
    final_json_structure = generate_full_json_config(parsed_outbounds)

    # ذخیره مستقیم JSON درون final_sub.txt
    with open('final_sub.txt', 'w', encoding='utf-8') as f:
        json.dump(final_json_structure, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
