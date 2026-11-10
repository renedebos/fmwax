// MC-38 STAGE 2B IN WORKERD: Amazon's signature check needs node:crypto's
// X509Certificate (the nodejs_compat flag) and a KeyObject turned into a
// WebCrypto key. Node has both; this proves the Worker's own runtime does,
// with the same wrangler.toml the deploy reads.
import { afterEach, describe, expect, it } from "vitest";

import { alexaSigned, alexaTrust, certsOf, chainRefusal, forgetChains } from "../alexa-sign.js";
import amazonChain from "../test/fixtures/alexa/amazon-chain.pem?raw";
import body from "../test/fixtures/alexa/body.json?raw";
import sig from "../test/fixtures/alexa/body.sig?raw";
import testChain from "../test/fixtures/alexa/test-chain.pem?raw";
import testRoot from "../test/fixtures/alexa/test-root.pem?raw";

const AT = Date.parse("2026-11-08T04:00:00Z");
const real = { roots: alexaTrust.roots, fetch: alexaTrust.fetch };
afterEach(() => { alexaTrust.roots = real.roots; alexaTrust.fetch = real.fetch; forgetChains(); });

describe("Amazon's signature check in workerd", () => {
  it("reads Amazon's real chain and walks it up to Amazon's root", () => {
    const certs = certsOf(amazonChain);
    expect(certs.length).toBe(3);
    expect(certs[0].subjectAltName).toBe("DNS:echo-api.amazon.com");
    expect(chainRefusal(certs, AT)).toBe(null);
  });
  it("passes a signed body and refuses a changed one", async () => {
    forgetChains();
    alexaTrust.roots = [testRoot];
    alexaTrust.fetch = async () => new Response(testChain);
    const url = "https://s3.amazonaws.com/echo.api/echo-api-cert-test.pem";
    expect(await alexaSigned({ sig, chainUrl: url, raw: body }, AT)).toEqual({ ok: true });
    expect((await alexaSigned({ sig, chainUrl: url, raw: body.replace("AskHank", "AskSoul") }, AT)).why)
      .toBe("the signature does not match the body");
  });
});
