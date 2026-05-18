function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): ArrayBuffer {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

export async function generateRoomKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64Url(raw);
}

export async function importRoomKey(b64: string): Promise<CryptoKey> {
  const raw = fromBase64Url(b64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { ciphertext: toBase64Url(ct), iv: toBase64Url(iv) };
}

export async function decryptMessage(
  key: CryptoKey,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const ctBuf = fromBase64Url(ciphertext);
  const ivBuf = fromBase64Url(iv);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    ctBuf,
  );
  return new TextDecoder().decode(pt);
}

export function readKeyFromHash(hash: string): string | null {
  const match = hash.match(/(?:^#|&)k=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}
