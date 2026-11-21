import assert from 'node:assert/strict';
import test from 'node:test';
import { isBlockedIpAddress, validateCentralApiUrlSyntax } from './ssrfGuard.ts';

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
