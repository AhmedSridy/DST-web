import dns from 'node:dns/promises';
import net from 'node:net';

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    acc = (acc << 8) | n;
  }
  return acc >>> 0;
}

function inIpv4Cidr(ipInt: number, baseIp: string, prefixLen: number): boolean {
  const baseInt = ipv4ToInt(baseIp);
  if (baseInt === null) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Returns true if the IPv4 or IPv6 address belongs to loopback, private,
 * link-local, metadata, multicast, CGNAT, or reserved non-public space.
 */
export function isBlockedIpAddress(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const ipVersion = net.isIP(ip);
  if (ipVersion === 0) return true;

  if (ipVersion === 4) {
    const ipInt = ipv4ToInt(ip);
    if (ipInt === null) return true;
    const blockedCidrs: Array<[string, number]> = [
      ['0.0.0.0', 8],       // "This" network
      ['10.0.0.0', 8],      // RFC 1918 private
      ['100.64.0.0', 10],   // RFC 6598 CGNAT
      ['127.0.0.0', 8],     // Loopback
      ['169.254.0.0', 16],  // Link-local & cloud metadata (169.254.169.254)
      ['172.16.0.0', 12],   // RFC 1918 private
      ['192.0.0.0', 24],    // IETF protocol assignments
      ['192.0.2.0', 24],    // TEST-NET-1
      ['192.168.0.0', 16],  // RFC 1918 private
      ['198.18.0.0', 15],   // Benchmarking
      ['198.51.100.0', 24], // TEST-NET-2
      ['203.0.113.0', 24],  // TEST-NET-3
      ['224.0.0.0', 4],     // Multicast
      ['240.0.0.0', 4],     // Reserved / broadcast
    ];
    return blockedCidrs.some(([base, prefix]) => inIpv4Cidr(ipInt, base, prefix));
  }

  // IPv6 checks
  if (ip === '::' || ip === '::1') return true;
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) {
      return isBlockedIpAddress(mapped);
    }
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIpAddress(v4);
    }
    return true;
  }

  const firstHextet = ip.split(':')[0] || '';
  const firstVal = parseInt(firstHextet, 16);
  if (Number.isNaN(firstVal)) return true;

  // fc00::/7 (Unique Local Addresses: fc00..fdff)
  if ((firstVal & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (Link-local: fe80..febf)
  if ((firstVal & 0xffc0) === 0xfe80) return true;
  // ff00::/8 (Multicast)
  if ((firstVal & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 (Documentation)
  if (ip.startsWith('2001:db8:') || ip.startsWith('2001:0db8:')) return true;

  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
]);

export function validateCentralApiUrlSyntax(
  rawUrl: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, reason: 'رابط واجهة التكامل المركزية غير مُعدّ.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'رابط واجهة التكامل المركزية غير صالح.' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'يُشترط أن يستخدم رابط التكامل المركزي بروتوكول HTTPS الآمن فقط.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason: 'غير مسموح بتضمين بيانات اعتماد داخل رابط التكامل المركزي.',
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return { ok: false, reason: 'اسم المضيف في رابط التكامل مفقود.' };
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    return {
      ok: false,
      reason: 'مرفوض أمنيًا: لا يُسمح بالإرسال إلى localhost أو نطاقات الشبكة الداخلية.',
    };
  }

  if (net.isIP(hostname) !== 0) {
    if (isBlockedIpAddress(hostname)) {
      return {
        ok: false,
        reason: 'مرفوض أمنيًا: لا يُسمح بالإرسال إلى عناوين IP الخاصة أو المحلية.',
      };
    }
  }

  return { ok: true, url: parsed };
}

export async function validateCentralApiUrl(
  rawUrl: string,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  const syntax = validateCentralApiUrlSyntax(rawUrl);
  if (!syntax.ok) return syntax;

  const hostname = syntax.url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname) !== 0) {
    return syntax;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) {
      return { ok: false, reason: 'تعذر حل عنوان DNS لرابط التكامل المركزي.' };
    }
    for (const rec of records) {
      if (isBlockedIpAddress(rec.address)) {
        return {
          ok: false,
          reason: 'مرفوض أمنيًا: عنوان الخادم يشير إلى شبكة خاصة أو محلية غير مسموح بها.',
        };
      }
    }
    return syntax;
  } catch {
    return {
      ok: false,
      reason: 'تعذر التحقق من عنوان DNS لرابط التكامل المركزي أو تعذر الوصول إليه.',
    };
  }
}
