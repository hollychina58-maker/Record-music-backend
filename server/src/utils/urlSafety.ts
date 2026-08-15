import { lookup } from 'dns/promises';

/**
 * 判断一个 IP 地址是否为私有/保留/环回/链路本地/组播/过渡地址。
 * 覆盖 IPv4 与 IPv6（含 IPv4-mapped、IPv4-compatible、6to4、Teredo、NAT64）。
 * 返回 true 表示「不可达公网」，应拒绝。
 */

/** 两组 hex（各 16 位）转 IPv4 点分十进制，失败返回 null */
function hexPairToIpv4(h1: string, h2: string): string | null {
  const hi = parseInt(h1, 16);
  const lo = parseInt(h2, 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return ((hi >> 8) & 0xff) + '.' + (hi & 0xff) + '.' + ((lo >> 8) & 0xff) + '.' + (lo & 0xff);
}

/** 从 IPv6 尾部提取 IPv4：支持 "xxxx:xxxx"（取最后两组）和 "x.x.x.x"（取点分十进制） */
function ipv4FromTail(tail: string): string | null {
  if (tail.includes('.')) {
    const m = tail.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    return m ? m[1] : null;
  }
  const groups = tail.split(':');
  const last2 = groups.slice(-2);
  if (last2.length !== 2 || !last2.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return hexPairToIpv4(last2[0], last2[1]);
}

export function isPrivateIp(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  if (s.includes(':')) {
    // === IPv6 ===
    if (s === '::1' || s === '::') return true;                  // 环回 / 未指定
    if (s.startsWith('fc') || s.startsWith('fd')) return true;   // ULA fc00::/7
    if (/^fe[89ab]/.test(s)) return true;                        // 链路本地 fe80::/10
    if (s.startsWith('ff')) return true;                         // 组播 ff00::/8
    if (s.startsWith('2001:db8') || s.startsWith('2001:0db8')) return true; // 文档 2001:db8::/32
    // Teredo 2001::/32：第二 16 位组必须为 0（含 :: 压缩形式 2001::xxxx）
    const teredo = s.match(/^2001:([0-9a-f]{0,4}):/);
    if (teredo && (teredo[1] === '' || /^0+$/.test(teredo[1]))) return true;
    if (s.startsWith('2002:')) {                                 // 6to4：IPv4 在 bits 16-47（前两组）
      const m = s.slice(5).match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})/);
      if (m) { const ipv4 = hexPairToIpv4(m[1], m[2]); if (ipv4) return isPrivateIp(ipv4); }
      return true;
    }
    if (s.startsWith('64:ff9b:')) {                              // NAT64 64:ff9b::/96：IPv4 在最后 32 位
      const ipv4 = ipv4FromTail(s.slice('64:ff9b:'.length));
      return ipv4 ? isPrivateIp(ipv4) : true;
    }
    if (s.startsWith('::ffff:')) {                               // IPv4-mapped ::ffff:0:0/96
      const ipv4 = ipv4FromTail(s.slice('::ffff:'.length));
      return ipv4 ? isPrivateIp(ipv4) : true;
    }
    if (s.startsWith('::')) {                                    // IPv4-compatible ::/96（废弃）
      const ipv4 = ipv4FromTail(s.slice(2));
      return ipv4 ? isPrivateIp(ipv4) : true;
    }
    return false; // 其余为公网 IPv6
  }
  // === IPv4 ===
  const parts = s.split('.');
  if (parts.length !== 4) return true; // 解析失败按不安全处理
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = nums[0], b = nums[1], c = nums[2];
  return (
    a === 0 || // 0.0.0.0/8 未指定
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 环回
    (a === 169 && b === 254) || // 169.254.0.0/16 链路本地
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24（仅保留段，192.0.1.0/24 等为公网）
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224 // 组播 224.0.0.0/4 + 保留 240.0.0.0/4
  );
}

/**
 * SSRF 防护：校验用户可控的音频参考 URL 只指向公网地址。
 * - 解括号（WHATWG 对 [::1] 这类 IPv6 字面量保留方括号，导致黑名单正则漏检）
 * - DNS 解析 hostname 得到全部 A/AAAA 记录，逐一拒绝私有/过渡地址
 * - 拒绝 .local 主机名
 * 调用方仍需对实际 HTTP 请求禁用重定向（maxRedirects: 0），防止 302 到内网。
 * 已知限制：DNS rebinding（lookup 与后续 HTTP 连接非原子）理论上可借短 TTL 双解析绕过，
 * 属 best-effort 防护，非 rebinding-proof。
 */
export async function assertSafeAudioUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid audio URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  // 解括号：'[::1]' → '::1'，'[::ffff:127.0.0.1]' → '::ffff:7f00:1'
  let host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.length === 0) throw new Error('Empty host');
  if (host === 'localhost' || host.endsWith('.local')) {
    throw new Error('Local hostnames are not allowed');
  }
  // DNS 解析（IP 字面量也会原样返回），逐一校验所有解析结果
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve host');
  }
  if (addresses.length === 0) throw new Error('Could not resolve host');
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new Error('Private / internal addresses are not allowed');
    }
  }
  return url;
}

/**
 * 消费端媒体 URL 白名单：file_path 只允许指向我们自己的 CDN 域名
 * （Cloudflare R2 或 MiniMax/阿里云 OSS），防止存储值被污染后变成 SSRF 代理。
 * 用于 /music/:id/stream 与 /download 等代理端点（配合 maxRedirects:0）。
 */
export function assertAllowedMediaHost(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid media URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  const host = url.hostname.toLowerCase();
  const allowed = [
    '.r2.dev',
    '.r2.cloudflarestorage.com',
    '.aliyuncs.com',
  ];
  const custom = process.env.R2_PUBLIC_URL;
  if (custom) {
    try {
      allowed.push(new URL(custom).hostname.toLowerCase());
    } catch { /* ignore malformed env */ }
  }
  if (!allowed.some((suffix) => host === suffix || host.endsWith(suffix))) {
    throw new Error('Media host not allowed: ' + host);
  }
}
