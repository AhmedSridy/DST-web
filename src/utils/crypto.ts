/**
 * Computes lowercase SHA-256 hex digest using the browser Web Crypto API.
 * Used so local/preview passwords are never stored in plaintext.
 */
export async function sha256Hex(plainText: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
