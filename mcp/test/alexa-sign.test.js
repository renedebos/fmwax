// MC-38 STAGE 2B, AMAZON'S SIGNATURE (alexa-sign.js). The test certificates
// in fixtures/alexa are made by make.sh there: a test root, an intermediate
// and a leaf named echo-api.amazon.com, a body that leaf signed, and the
// near-misses. amazon-chain.pem is Amazon's real public chain.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

import { alexaSigned, alexaTrust, certsOf, chainRefusal, chainUrlOk, forgetChains } from "../alexa-sign.js";

const fx = (name) => readFileSync(new URL(`./fixtures/alexa/${name}`, import.meta.url), "utf8");
const BODY = fx("body.json");
const SIG = fx("body.sig");
const AT = Date.parse("2026-11-08T04:00:00Z");
const URL_OK = "https://s3.amazonaws.com/echo.api/echo-api-cert-test.pem";
const real = { roots: alexaTrust.roots, fetch: alexaTrust.fetch };

// The test root trusted, and the chain address answered with `chain`.
let fetched = 0;
function trustTest(chain = fx("test-chain.pem"), status = 200) {
  forgetChains();
  fetched = 0;
  alexaTrust.roots = [fx("test-root.pem")];
  alexaTrust.fetch = async () => { fetched++; return new Response(chain, { status }); };
}
afterEach(() => { alexaTrust.roots = real.roots; alexaTrust.fetch = real.fetch; forgetChains(); });

test("the chain's address: Amazon's own examples, valid and not", () => {
  for (const ok of ["https://s3.amazonaws.com/echo.api/echo-api-cert.pem", "HTTPS://s3.amazonaws.com/echo.api/echo-api-cert.pem",
    "https://s3.AMAZONAWS.com/echo.api/echo-api-cert.pem", "https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem",
    "https://s3.amazonaws.com/echo.api/../echo.api/echo-api-cert.pem"]) {
    assert.equal(chainUrlOk(ok), "https://s3.amazonaws.com/echo.api/echo-api-cert.pem", ok);
  }
  for (const bad of ["http://s3.amazonaws.com/echo.api/echo-api-cert.pem", "https://notamazon.com/echo.api/echo-api-cert.pem",
    "https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem", "https://s3.amazonaws.com/invalid.path/echo-api-cert.pem",
    "https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem", "https://s3.amazonaws.com/echo.api/../invalid.path/x.pem",
    "https://user@s3.amazonaws.com/echo.api/x.pem", "s3.amazonaws.com/echo.api/x.pem", "", null]) {
    assert.equal(chainUrlOk(bad), null, String(bad));
  }
});

test("Amazon's roots in the code are the ones their fingerprints name", () => {
  const prints = real.roots.map((p) => new X509Certificate(p).fingerprint256);
  assert.deepEqual(prints, [
    "8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E",
    "56:8D:69:05:A2:C8:87:08:A4:B3:02:51:90:ED:CF:ED:B1:97:4A:60:6A:13:C6:E5:29:0F:CB:2A:E6:3E:DA:B5",
  ]);
});

test("Amazon's real chain leads to Amazon's root, while its dates hold", () => {
  const certs = certsOf(fx("amazon-chain.pem"));
  assert.equal(certs.length, 3);
  assert.equal(chainRefusal(certs, AT), null);
  assert.equal(chainRefusal(certs, Date.parse("2027-06-01T00:00:00Z")), "the signing certificate is out of date");
  // And not to a root nobody trusts.
  assert.equal(chainRefusal(certs, AT, [new X509Certificate(fx("test-root.pem"))]), "the chain does not lead to a trusted root");
});

test("a body its signing certificate signed passes; a changed one does not", async () => {
  trustTest();
  assert.deepEqual(await alexaSigned({ sig: SIG, chainUrl: URL_OK, raw: BODY }, AT), { ok: true });
  const changed = BODY.replace('"AskHank"', '"AskSoul"');
  assert.deepEqual(await alexaSigned({ sig: SIG, chainUrl: URL_OK, raw: changed }, AT),
    { ok: false, why: "the signature does not match the body" });
  assert.equal((await alexaSigned({ sig: SIG, chainUrl: URL_OK, raw: `${BODY} ` }, AT)).ok, false);
  // The chain was fetched once and kept.
  assert.equal(fetched, 1);
});

test("each refusal, in the words the log keeps", async () => {
  const why = async (args, chain, status) => { trustTest(chain, status); return (await alexaSigned({ sig: SIG, chainUrl: URL_OK, raw: BODY, ...args }, AT)).why; };
  assert.equal(await why({ sig: null }), "no Signature-256");
  assert.equal(await why({ chainUrl: "https://example.com/echo.api/x.pem" }), "the certificate address is not Amazon's");
  assert.equal(await why({}, fx("named-chain.pem")), "the signing certificate does not name echo-api.amazon.com");
  assert.equal(await why({ sig: fx("other.sig") }, fx("other-chain.pem")), "the chain does not lead to a trusted root");
  assert.match(await why({}, "nothing here", 200), /^no certificate chain \(no certificate in the chain\)$/);
  assert.match(await why({}, "gone", 404), /^no certificate chain \(chain fetch 404\)$/);
  assert.equal(await why({ sig: "not base64 !!" }), "the signature is not base64");
  // Signed by another leaf of the same chain's shape: no match.
  assert.equal(await why({ sig: fx("named.sig") }), "the signature does not match the body");
  // Out of date: the same chain ten years on.
  trustTest();
  assert.equal((await alexaSigned({ sig: SIG, chainUrl: URL_OK, raw: BODY }, Date.parse("2040-01-01T00:00:00Z"))).why,
    "the signing certificate is out of date");
});
