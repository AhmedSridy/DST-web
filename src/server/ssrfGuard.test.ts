import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSsrfSafeLookup,
  isBlockedIpAddress,
  validateCentralApiUrlSyntax,
  type BaseDnsLookup,
} from './ssrfGuard.ts';

test('isBlockedIpAddress blocks loopback, private, link-local, metadata, and IPv6 local addresses', () => {
  assert.equal(isBlockedIpAddress('127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('10.0.0.5'), true);
  assert.equal(isBlockedIpAddress('172.16.10.2'), true);
  assert.equal(isBlockedIpAddress('192.168.1.10'), true);
  assert.equal(isBlockedIpAddress('169.254.169.254'), true);
  assert.equal(isBlockedIpAddress('100.64.0.1'), true);
  assert.equal(isBlockedIpAddress('0.0.0.0'), true);
  assert.equal(isBlockedIpAddress('::1'), true);
  assert.equal(isBlockedIpAddress('fe80::1'), true);
  assert.equal(isBlockedIpAddress('fd12:3456::1'), true);
  assert.equal(isBlockedIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('::ffff:169.254.169.254'), true);
});

test('isBlockedIpAddress allows public IPv4 and IPv6 addresses', () => {
  assert.equal(isBlockedIpAddress('8.8.8.8'), false);
  assert.equal(isBlockedIpAddress('1.1.1.1'), false);
  assert.equal(isBlockedIpAddress('196.219.12.5'), false);
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111'), false);
});

test('validateCentralApiUrlSyntax requires HTTPS and rejects localhost/private IPs/credentials', () => {
  assert.equal(validateCentralApiUrlSyntax('').ok, false);
  assert.equal(validateCentralApiUrlSyntax('http://example.com/api').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://localhost/api').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://sub.localhost/api').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://metadata.google.internal/computeMetadata').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://127.0.0.1/api').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://192.168.1.50/api').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://169.254.169.254/latest').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://[::1]/api').ok, false);
  assert.equal(validateCentralApiUrlSyntax('https://user:pass@api.example.com/sync').ok, false);

  const valid = validateCentralApiUrlSyntax('https://api.example.gov.eg/v1/fertilizer-reports');
  assert.equal(valid.ok, true);
});

test('createSsrfSafeLookup rejects private/metadata IPs at connect time (DNS rebinding guard)', async () => {
  const rebindingLookup: BaseDnsLookup = (_hostname, _opts, cb) => {
    cb(null, [{ address: '169.254.169.254', family: 4 }]);
  };
  const safeLookup = createSsrfSafeLookup(rebindingLookup);

  await assert.rejects(
    new Promise((resolve, reject) => {
      safeLookup('rebind.example.com', { all: true }, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    }),
    /مرفوض أمنيًا/,
  );

  // Mixed public + private resolution must also be rejected completely
  const mixedLookup: BaseDnsLookup = (_hostname, _opts, cb) => {
    cb(null, [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
  };
  const safeMixedLookup = createSsrfSafeLookup(mixedLookup);

  await assert.rejects(
    new Promise((resolve, reject) => {
      safeMixedLookup('dual.example.com', {}, (err, addr) => {
        if (err) reject(err);
        else resolve(addr);
      });
    }),
    /مرفوض أمنيًا/,
  );
});

test('createSsrfSafeLookup permits verified public IPs in single and all modes', async () => {
  const publicLookup: BaseDnsLookup = (_hostname, _opts, cb) => {
    cb(null, [{ address: '93.184.216.34', family: 4 }]);
  };
  const safeLookup = createSsrfSafeLookup(publicLookup);

  const singleResult = await new Promise<{ address: string; family?: number }>((resolve, reject) => {
    safeLookup('api.example.gov.eg', {}, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address: String(address), family });
    });
  });
  assert.equal(singleResult.address, '93.184.216.34');
  assert.equal(singleResult.family, 4);

  const allResult = await new Promise<unknown>((resolve, reject) => {
    safeLookup('api.example.gov.eg', { all: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  assert.deepEqual(allResult, [{ address: '93.184.216.34', family: 4 }]);
});
