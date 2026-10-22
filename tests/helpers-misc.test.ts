import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv, formatMoney } from "../src/lib/format.ts";
import { sniffImage } from "../src/lib/image-sniff.ts";
import { rateLimit } from "../src/lib/rate-limit.ts";
import { safeNext } from "../src/lib/redirect.ts";

test("safeNext blocks open redirects", () => {
  assert.equal(safeNext("/app/scores"), "/app/scores");
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/ok\r\nSet-Cookie: x=1", "", null, undefined]) assert.equal(safeNext(bad as string), "/app");
  assert.equal(safeNext("//x", "/login"), "/login");
});

test("toCsv escapes quotes/commas and neutralises spreadsheet formulas", () => {
  const csv = toCsv([{ a: '=HYPERLINK("x")', b: "plain, with comma", c: null, d: '@cmd', e: 'say "hi"' }]);
  const [head, row] = csv.split("\n");
  assert.equal(head, "a,b,c,d,e");
  assert.ok(row.startsWith(`"'=HYPERLINK(""x"")"`));
  assert.ok(row.includes('"plain, with comma"'));
  assert.ok(row.includes(`,'@cmd,`));
  assert.ok(row.endsWith('"say ""hi"""'));
  assert.equal(toCsv([]), "");
});

test("sniffImage trusts bytes, not declared types", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat([1, 2, 3, 4], [..."WEBP"].map((c) => c.charCodeAt(0)), [0, 0]));
  assert.equal(sniffImage(png), "image/png");
  assert.equal(sniffImage(jpg), "image/jpeg");
  assert.equal(sniffImage(webp), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("MZ executable")), null);
});

test("rateLimit allows up to the limit then blocks until the window passes", () => {
  const k = `t-${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(k, 3, 1000, 1000 + i).ok, true);
  const blocked = rateLimit(k, 3, 1000, 1500);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(rateLimit(k, 3, 1000, 2100).ok, true);
});

test("formatMoney formats integer paise with Indian grouping and no float drift", () => {
  assert.equal(formatMoney(99900), "₹999");
  assert.equal(formatMoney(12345678), "₹1,23,456.78");
  assert.equal(formatMoney(5), "₹0.05");
  assert.equal(formatMoney(0), "₹0");
});
