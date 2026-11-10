// AMAZON'S SIGNATURE ON A HOUSE RADIO REQUEST (MC-38 stage 2b,
// tasks/mc38-alexa-skill.md). Every request Alexa sends carries a
// Signature-256 header, an RSA signature with SHA-256 over the body as sent,
// and a SignatureCertChainUrl header naming the certificate chain to check it
// with. The door acts only on a request this check passes, so a request made
// by someone who learned the door's address, but is not Amazon, is refused.
// Amazon's steps for a skill hosted outside Lambda
// (developer.amazon.com, "Host a Custom Skill as a Web Service"):
//  1. the chain's address: https, host s3.amazonaws.com (any case), path
//     starting /echo.api/ once normalized, port 443 if any;
//  2. the chain fetched from it;
//  3. the signing certificate valid now, its alternative names holding
//     echo-api.amazon.com;
//  4. every certificate leading up to a trusted root;
//  5. the signature checked with the signing certificate's public key over
//     the raw body.
// Proved on the 51 real requests of 2026-11-07 before it was built: all 51
// passed, and none once its body was changed.
//
// The certificates are read with node:crypto's X509Certificate (the
// nodejs_compat flag, wrangler.toml); the signature with WebCrypto.

import { X509Certificate } from "node:crypto";

export const ALEXA_SAN = "echo-api.amazon.com";
const CHAIN_MAX = 64 * 1024;
const CHAIN_KEEP_MS = 60 * 60 * 1000;

// The roots Amazon's chain leads to: Amazon Root CA 1, and the Starfield root
// that cross-signs it. Public certificates, as Mozilla's store has them
// (Debian's ca-certificates), checked by their SHA-256 fingerprints:
// Amazon Root CA 1 8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E,
// Starfield Services G2 56:8D:69:05:A2:C8:87:08:A4:B3:02:51:90:ED:CF:ED:B1:97:4A:60:6A:13:C6:E5:29:0F:CB:2A:E6:3E:DA:B5.
const AMAZON_ROOT_CA_1 = `-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----`;
const STARFIELD_SERVICES_ROOT_G2 = `-----BEGIN CERTIFICATE-----
MIID7zCCAtegAwIBAgIBADANBgkqhkiG9w0BAQsFADCBmDELMAkGA1UEBhMCVVMx
EDAOBgNVBAgTB0FyaXpvbmExEzARBgNVBAcTClNjb3R0c2RhbGUxJTAjBgNVBAoT
HFN0YXJmaWVsZCBUZWNobm9sb2dpZXMsIEluYy4xOzA5BgNVBAMTMlN0YXJmaWVs
ZCBTZXJ2aWNlcyBSb290IENlcnRpZmljYXRlIEF1dGhvcml0eSAtIEcyMB4XDTA5
MDkwMTAwMDAwMFoXDTM3MTIzMTIzNTk1OVowgZgxCzAJBgNVBAYTAlVTMRAwDgYD
VQQIEwdBcml6b25hMRMwEQYDVQQHEwpTY290dHNkYWxlMSUwIwYDVQQKExxTdGFy
ZmllbGQgVGVjaG5vbG9naWVzLCBJbmMuMTswOQYDVQQDEzJTdGFyZmllbGQgU2Vy
dmljZXMgUm9vdCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgLSBHMjCCASIwDQYJKoZI
hvcNAQEBBQADggEPADCCAQoCggEBANUMOsQq+U7i9b4Zl1+OiFOxHz/Lz58gE20p
OsgPfTz3a3Y4Y9k2YKibXlwAgLIvWX/2h/klQ4bnaRtSmpDhcePYLQ1Ob/bISdm2
8xpWriu2dBTrz/sm4xq6HZYuajtYlIlHVv8loJNwU4PahHQUw2eeBGg6345AWh1K
Ts9DkTvnVtYAcMtS7nt9rjrnvDH5RfbCYM8TWQIrgMw0R9+53pBlbQLPLJGmpufe
hRhJfGZOozptqbXuNC66DQO4M99H67FrjSXZm86B0UVGMpZwh94CDklDhbZsc7tk
6mFBrMnUVN+HL8cisibMn1lUaJ/8viovxFUcdUBgF4UCVTmLfwUCAwEAAaNCMEAw
DwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFJxfAN+q
AdcwKziIorhtSpzyEZGDMA0GCSqGSIb3DQEBCwUAA4IBAQBLNqaEd2ndOxmfZyMI
bw5hyf2E3F/YNoHN2BtBLZ9g3ccaaNnRbobhiCPPE95Dz+I0swSdHynVv/heyNXB
ve6SbzJ08pGCL72CQnqtKrcgfU28elUSwhXqvfdqlS5sdJ/PHLTyxQGjhdByPq1z
qwubdQxtRbeOlKyWN7Wg0I8VRw7j6IPdj/3vQQF3zCepYoUz8jcI73HPdwbeyBkd
iEDPfUYd/x7H4c7/I9vG+o1VTqkC50cRRj70/b17KSa7qWFiNyi2LSr2EIZkyXCn
0q23KXB56jzaYyWf/Wi3MOxw+3WKt21gZ7IeyLnp2KhvAotnDU0mV3HaIPzBSlCN
sSi6
-----END CERTIFICATE-----`;

const CHAIN_FETCH_MS = 2500;
// What the check trusts and how it fetches. Tests put their own root here;
// nothing a request or the house's settings say can change it.
export const alexaTrust = {
  roots: [AMAZON_ROOT_CA_1, STARFIELD_SERVICES_ROOT_G2],
  // Bounded: a slow fetch is a refusal, never a wait past Alexa's eight
  // seconds (Codex's review, 2026-11-08). One fetch an hour per isolate.
  fetch: (url) => fetch(url, { signal: AbortSignal.timeout(CHAIN_FETCH_MS) }),
};

// Step 1: the chain's address as Amazon allows it, normalized, or null.
export function chainUrlOk(raw) {
  let u;
  try { u = new URL(String(raw ?? "")); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "s3.amazonaws.com") return null;
  if (u.port !== "" && u.port !== "443") return null;
  if (u.username || u.password || !u.pathname.startsWith("/echo.api/")) return null;
  return `https://s3.amazonaws.com${u.pathname}`;
}

const PEM = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g;
export const certsOf = (text) => (String(text ?? "").match(PEM) ?? []).slice(0, 5).map((p) => new X509Certificate(p));

// Step 2, kept per isolate an hour by address (the chain changes a few times
// a year; its dates are checked on every request all the same).
const CHAINS = new Map();
async function chainAt(url, now) {
  const kept = CHAINS.get(url);
  if (kept && kept.until > now) return kept.certs;
  const r = await alexaTrust.fetch(url);
  if (!r.ok) throw new Error(`chain fetch ${r.status}`);
  const text = await r.text();
  if (text.length > CHAIN_MAX) throw new Error("chain too big");
  const certs = certsOf(text);
  if (!certs.length) throw new Error("no certificate in the chain");
  CHAINS.set(url, { certs, until: now + CHAIN_KEEP_MS });
  return certs;
}
export function forgetChains() { CHAINS.clear(); }

const inDate = (c, now) => Date.parse(c.validFrom) <= now && now <= Date.parse(c.validTo);

// Steps 3 and 4 on parsed certificates: null when they hold, else why not.
export function chainRefusal(certs, now, roots = alexaTrust.roots.map((p) => new X509Certificate(p))) {
  const leaf = certs[0];
  if (!leaf) return "no signing certificate";
  if (!inDate(leaf, now)) return "the signing certificate is out of date";
  if (leaf.ca) return "the signing certificate is a CA";
  const names = String(leaf.subjectAltName ?? "").split(/,\s*/);
  if (!names.includes(`DNS:${ALEXA_SAN}`)) return `the signing certificate does not name ${ALEXA_SAN}`;
  let cur = leaf;
  for (let i = 1; i <= certs.length; i++) {
    if (!inDate(cur, now)) return `certificate ${i} is out of date`;
    if (roots.some((r) => inDate(r, now) && cur.checkIssued(r) && cur.verify(r.publicKey))) return null;
    const up = certs[i];
    if (!up || !up.ca || !cur.checkIssued(up) || !cur.verify(up.publicKey)) return "the chain does not lead to a trusted root";
    cur = up;
  }
  return "the chain does not lead to a trusted root";
}

function bytesOfBase64(s) {
  const bin = atob(String(s).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The whole check: { ok: true } or { ok: false, why }.
export async function alexaSigned({ sig, chainUrl, raw }, now = Date.now()) {
  if (!sig) return { ok: false, why: "no Signature-256" };
  const url = chainUrlOk(chainUrl);
  if (!url) return { ok: false, why: "the certificate address is not Amazon's" };
  let certs;
  try { certs = await chainAt(url, now); } catch (e) { return { ok: false, why: `no certificate chain (${e?.message ?? e})` }; }
  const refused = chainRefusal(certs, now);
  if (refused) return { ok: false, why: refused };
  let signature;
  try { signature = bytesOfBase64(sig); } catch { return { ok: false, why: "the signature is not base64" }; }
  try {
    const spki = certs[0].publicKey.export({ type: "spki", format: "der" });
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(raw ?? ""));
    return good ? { ok: true } : { ok: false, why: "the signature does not match the body" };
  } catch (e) {
    return { ok: false, why: `the signature could not be checked (${e?.message ?? e})` };
  }
}
