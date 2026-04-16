# Apple Wallet Certificates

Place the following files here (or set the `APPLE_*_PATH` env vars to custom paths):

| File | Description |
|------|-------------|
| `wwdr.pem` | Apple WWDR CA (AppleWWDRCAG4) — download from apple.com/certificateauthority |
| `signerCert.pem` | Your Pass Type certificate |
| `signerKey.pem` | Private key (extracted from the .p12 export) |

## How to obtain them

1. **developer.apple.com** → Certificates, IDs & Profiles → create a **Pass Type ID** (e.g. `pass.com.rewardshub.card`)
2. Create a certificate for that Pass Type ID, download the `.cer` file, then convert:
   ```bash
   openssl x509 -in pass.cer -inform DER -out signerCert.pem
   ```
3. Export the private key from Keychain as `.p12`, then:
   ```bash
   openssl pkcs12 -in certs.p12 -nocerts -out signerKey.pem -nodes
   ```
4. Download `AppleWWDRCAG4.cer` from https://www.apple.com/certificateauthority/ then:
   ```bash
   openssl x509 -in AppleWWDRCAG4.cer -inform DER -out wwdr.pem
   ```

## Required environment variables

```
APPLE_TEAM_ID=AB12CD34EF          # Your Apple Developer Team ID
APPLE_PASS_TYPE_ID=pass.com.rewardshub.card
APPLE_CERT_PASSWORD=              # Password for the .p12 (leave empty if none)
```

**Do not commit these files to git.** Add `certs/` to `.gitignore`.
