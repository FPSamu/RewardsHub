# Google Wallet Credentials

Place the following file here (or set the `GOOGLE_SERVICE_ACCOUNT` env var to a custom path):

| File | Description |
|------|-------------|
| `service-account.json` | Google Cloud Service Account credentials (JSON key) |

## How to obtain them

1. Go to [pay.google.com/business/console](https://pay.google.com/business/console) and create an Issuer Account. Copy the **Issuer ID**.
2. In [console.cloud.google.com](https://console.cloud.google.com) → IAM & Admin → Service Accounts → create a new service account and download the **JSON key**.
3. Back in the Google Wallet Console, add that service account email with the **Manager** role.

## Required environment variables

```
GOOGLE_ISSUER_ID=3388000000012345678     # Issuer ID from Google Pay Console
GOOGLE_CLASS_ID=rewardshub_loyalty_card  # Suffix for the loyalty class ID
GOOGLE_SERVICE_ACCOUNT=./certs/google/service-account.json
```

**Do not commit the service-account.json to git.** Add `certs/` to `.gitignore`.
