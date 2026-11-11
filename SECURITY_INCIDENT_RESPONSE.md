# AZURA Security Incident Response — Credential Exposure

## Status

A historical commit in this public repository removed several credential-like values from `src/config.js`. The values were present in the commit diff and must be treated as exposed, even though the current branch no longer contains those defaults.

Evidence: commit `b435489891ed8afa64dcaabc1d15f76ab1c40ba7` (2026-09-05), titled "security(config): purge all hardcoded API keys and secrets from fallback defaults in src/config.js".

This document intentionally does not reproduce any secret values.

## Credentials to rotate or review immediately

| Credential / setting | Required action |
|---|---|
| Groq API key | Revoke the exposed key at the provider and create a replacement |
| ElevenLabs API key | Revoke and replace; review usage/billing logs |
| Tavily API key | Revoke and replace |
| Discord bot token | Reset in Discord Developer Portal if it was ever exposed elsewhere in history |
| Discord self-bot user token | Treat as compromised; revoke session/token and stop using self-bot automation. Use an approved Discord bot/API integration instead |
| Database encryption key | Assess whether it was used to encrypt production vault data. Do not rotate until backup and controlled decrypt/re-encrypt migration are ready |
| Master security password | Change immediately; do not reuse the exposed value |
| Owner Discord ID | Not a credential by itself. Verify it is the intended owner ID; do not treat it as an authentication factor |

The historical diff proves that credential-like strings existed in the repository history. It does not prove whether each value was active, valid, or used in production at the time of exposure. Provider-side revocation and audit logs are needed to establish that.

## Safe rotation order

1. Restrict repository and deployment access while responding to the incident.
2. Back up the encrypted vault and blacklist files. Store the backup offline with restricted access.
3. Rotate provider API keys (Groq, ElevenLabs, Tavily, OpenAI if any historical exposure is found) and update deployment environment variables.
4. Reset Discord bot credentials if exposure is confirmed or cannot be ruled out. Re-authorize the bot with minimum required permissions.
5. Stop using Discord self-bot user tokens. Replace the self-bot streaming workflow with supported bot functionality.
6. Set a new strong `MASTER_SECURITY_PASSWORD`.
7. Set a unique `SESSION_SIGNING_KEY` (at least 32 random bytes; generate with `openssl rand -hex 32`).
8. For `DATABASE_ENCRYPTION_KEY`, first verify which key encrypted the existing vault. If the historical key encrypted current data, migrate in a controlled offline procedure: decrypt with the old key, validate record counts and integrity, encrypt with a new random key, then verify decryption with the new key. Keep a protected backup until verification completes.
9. Review provider usage, billing, access logs, Discord audit logs, and deployment logs from the earliest possible exposure date.
10. After rotation, remove old credentials from hosting variables, CI/CD secrets, local developer machines, and backups that are no longer required.

## Git history remediation

Removing secrets from the latest source does not remove them from old commits. After all affected credentials have been rotated:
- Coordinate a history rewrite (for example, `git filter-repo`) with every collaborator.
- Force-push the rewritten history only after a backup and maintenance window.
- Ask collaborators to re-clone; old clones and forks may retain the exposed history.
- Request cache cleanup from hosting providers where applicable.
- Do not rely on history rewriting as a substitute for credential rotation.

## Live Portal access boundary

The Live Portal exposes browser/game control and owner dashboard data. Keep `STREAM_HOST=127.0.0.1` and firewall the application port. Remote access must pass through an HTTPS reverse proxy that enforces authentication and authorization. CORS and Origin checks are not substitutes for user authentication.

## Deployment checklist

- [ ] Provider credentials revoked and replaced
- [ ] Discord token/session reviewed and reset where required
- [ ] Self-bot functionality disabled/replaced
- [ ] Owner ID verified
- [ ] Master password replaced
- [ ] Session signing key generated and configured
- [ ] Existing vault backed up and encryption-key migration validated, if required
- [ ] Live Portal remains loopback-only or protected by an authenticated reverse proxy
- [ ] Runtime tests and security review completed
- [ ] Git history rewrite coordinated after rotation

## Scope and limitations

This document records a source-history finding and response plan. It does not revoke credentials, inspect provider account activity, modify deployment secrets, rewrite Git history, or prove that the current production environment is secure.
