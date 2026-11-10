#!/usr/bin/env bash
# MC-38 stage 2b's test certificates (mcp/test/alexa-sign.test.js and
# test-workerd/alexa-sign.test.js). A test root, an intermediate and a leaf
# named echo-api.amazon.com, as Amazon's chain is shaped; a leaf named
# otherwise; a chain to a root nobody trusts; and a request body signed by
# each leaf. The private keys live in a temporary folder and are thrown away,
# so only public certificates and signatures are kept here. Run from this
# folder: bash make.sh. amazon-chain.pem is Amazon's real public chain, as
# fetched from its SignatureCertChainUrl on 2026-11-07; this script leaves it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
ca() { # name subject [issuer]
  openssl req -new -newkey rsa:2048 -nodes -keyout "$1.key" -subj "$2" -out "$1.csr" 2>/dev/null
  printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n' > "$1.ext"
  if [ -z "${3:-}" ]; then
    openssl x509 -req -in "$1.csr" -signkey "$1.key" -days 3650 -extfile "$1.ext" -out "$1.pem" 2>/dev/null
  else
    openssl x509 -req -in "$1.csr" -CA "$3.pem" -CAkey "$3.key" -CAcreateserial -days 3650 -extfile "$1.ext" -out "$1.pem" 2>/dev/null
  fi
}
leaf() { # name san issuer
  openssl req -new -newkey rsa:2048 -nodes -keyout "$1.key" -subj "/CN=$2" -out "$1.csr" 2>/dev/null
  printf 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:%s\n' "$2" > "$1.ext"
  openssl x509 -req -in "$1.csr" -CA "$3.pem" -CAkey "$3.key" -CAcreateserial -days 3650 -extfile "$1.ext" -out "$1.pem" 2>/dev/null
}
ca root "/C=US/O=House Radio Test/CN=Test Root CA"
ca mid "/C=US/O=House Radio Test/CN=Test RSA 2048 M01" root
leaf good echo-api.amazon.com mid
leaf named echo-api.example.com mid
ca other "/C=US/O=Nobody/CN=Other Root CA"
ca othermid "/C=US/O=Nobody/CN=Other RSA 2048" other
leaf otherleaf echo-api.amazon.com othermid
cat > body.json <<'JSON'
{"version":"1.0","session":{"new":true,"sessionId":"amzn1.echo-api.session.test","application":{"applicationId":"amzn1.ask.skill.00000000-test"}},"context":{"System":{"application":{"applicationId":"amzn1.ask.skill.00000000-test"},"device":{"deviceId":"amzn1.ask.device.TESTDEVICE0000"}}},"request":{"type":"IntentRequest","requestId":"amzn1.echo-api.request.test","locale":"en-US","timestamp":"2026-11-08T04:00:00Z","intent":{"name":"AskHank","confirmationStatus":"NONE","slots":{}}}}
JSON
printf '%s' "$(cat body.json)" > body.raw
sig() { openssl dgst -sha256 -sign "$1.key" body.raw | base64 -w0; }
cp root.pem "$here/test-root.pem"
cat good.pem mid.pem > "$here/test-chain.pem"
cat named.pem mid.pem > "$here/named-chain.pem"
cat otherleaf.pem othermid.pem other.pem > "$here/other-chain.pem"
cp body.raw "$here/body.json"
sig good > "$here/body.sig"
sig named > "$here/named.sig"
sig otherleaf > "$here/other.sig"
echo "made in $here"
