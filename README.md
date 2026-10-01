# goldenstraddler.com

Sales site, checkout, customer accounts, admin and the licence API for the GoldenStraddler MT5 EA.

- Runtime: Bun + SQLite (on a Railway volume)
- Pages: `web/` (static), server: `server/`
- Legal pages are built from `tools/legal_build.py`, the user guide PDF from `tools/guide/build.py`

## Environment

| Variable | What |
|---|---|
| `SITE_URL` | `https://goldenstraddler.com` |
| `OWNER_EMAIL`, `OWNER_TOTP_SECRET` | first admin (authenticator sign-in) |
| `EA_SIGN_SECRET` | must match the secret compiled into the EA |
| `APP_SECRET` | encrypts stored keys (generated on the volume if not set) |
| `RECORD_URL` | public record feed of the live account (optional) |

Payment and email keys are entered in Admin → Settings and stored encrypted. The compiled EA is uploaded in Admin → Settings and lives on the volume, never in git.

## Local

```
bun install
DEV=1 MOCK_PAY=1 PORT=4100 DATA_DIR=./data OWNER_EMAIL=you@example.com OWNER_TOTP_SECRET=... EA_SIGN_SECRET=... bun run server/index.ts
```
