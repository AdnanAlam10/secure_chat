import { describe, it, expect } from "vitest";
import {
  decryptMessage,
  encryptMessage,
  generateRoomKey,
  importRoomKey,
  readKeyFromHash,
} from "./crypto";

describe("crypto", () => {
  it("roundtrips plaintext through encrypt/decrypt", async () => {
    const b64 = await generateRoomKey();
    const key = await importRoomKey(b64);
    const { ciphertext, iv } = await encryptMessage(key, "hello world");
    const out = await decryptMessage(key, ciphertext, iv);
    expect(out).toBe("hello world");
  });

  it("produces a fresh IV per encryption", async () => {
    const key = await importRoomKey(await generateRoomKey());
    const a = await encryptMessage(key, "same text");
    const b = await encryptMessage(key, "same text");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects decryption with the wrong key", async () => {
    const k1 = await importRoomKey(await generateRoomKey());
    const k2 = await importRoomKey(await generateRoomKey());
    const { ciphertext, iv } = await encryptMessage(k1, "secret");
    await expect(decryptMessage(k2, ciphertext, iv)).rejects.toThrow();
  });

  it("rejects decryption with a tampered ciphertext", async () => {
    const key = await importRoomKey(await generateRoomKey());
    const { ciphertext, iv } = await encryptMessage(key, "secret");
    const tampered =
      ciphertext.slice(0, -2) + (ciphertext.endsWith("A") ? "B" : "A");
    await expect(decryptMessage(key, tampered, iv)).rejects.toThrow();
  });

  it("supports unicode payloads", async () => {
    const key = await importRoomKey(await generateRoomKey());
    const msg = "héllo 🦊 —   ​ nul\0byte";
    const { ciphertext, iv } = await encryptMessage(key, msg);
    expect(await decryptMessage(key, ciphertext, iv)).toBe(msg);
  });

  it("parses k= from a URL fragment", () => {
    expect(readKeyFromHash("#k=abc123_-xyz")).toBe("abc123_-xyz");
    expect(readKeyFromHash("#x=foo&k=abc")).toBe("abc");
    expect(readKeyFromHash("")).toBeNull();
    expect(readKeyFromHash("#other=value")).toBeNull();
  });
});
