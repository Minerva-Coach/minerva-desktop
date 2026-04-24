# Desktop App Updater Signing Key — Runbook

The desktop app's auto-update system depends on a single signing keypair.
**If the private key is lost, every existing installation loses the ability to
auto-update, and users must manually reinstall.** This document exists so that
outcome is preventable and, if it ever happens, recoverable under pressure.

## What the key protects

The updater uses minisign asymmetric signing:

- **Private key** — signs every release bundle (produces `.sig` files in CI).
  Stored in the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret on the
  `MinervaMVP` repo.
- **Public key** — compiled into every installed binary via
  `desktop_app/src-tauri/tauri.conf.json`, `plugins.updater.pubkey`.
  Cannot be changed on an installed app; it's baked into the executable.

On startup, every installed client fetches `latest.json`, downloads the new
bundle, and verifies its `.sig` against the embedded public key. Signature
mismatch aborts the update silently — the user sees "my app never updates."

There is no fallback, override, or secondary key.

## Do these things now (one-time setup)

### 1. Back up the private key

Right now the key lives in exactly one place: GitHub's secret store. Anyone
with admin rights on `MinervaMVP` can delete it. There is no way to recover a
deleted secret.

Store a copy in **at least** two independent locations:

- A password manager entry (1Password, Bitwarden, etc.) labeled
  `minerva-desktop-tauri-signing-key`
- Optionally, an offline encrypted backup (USB stick, encrypted disk image)

The key is a short ASCII blob. Paste it into the note field of the password
manager entry. Also record the public key alongside it, so you can verify you
have the matching pair.

To retrieve the key from GitHub for backup:

1. Re-generate locally with `tauri signer generate` if you still have the
   original pair somewhere, or
2. If only GitHub has it, you cannot read it back — secrets are write-only
   once set. In that case, rotate to a new key now (see rotation procedure
   below) while you still control the ecosystem.

### 2. Set a passphrase on the existing key (REQUIRED before next release)

The workflow now reads the passphrase from the
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secret (previously it
was hardcoded to an empty string). Until the secret is set, the passphrase
resolves to empty and the key is as exposed as it was before — a leaked
secret file alone can sign.

Procedure to add a passphrase without rotating the key (so existing
installs keep auto-updating):

1. Retrieve the current private key from your backup in the password
   manager (you followed step 1 above, right?). If you don't have a
   backup yet, you cannot re-encrypt — go back and do step 1.
2. Re-encrypt it on a trusted machine:
   ```bash
   tauri signer sign -p "<new passphrase>" -w minerva-backup.key
   ```
   Or use `minisign -C -s minerva-backup.key` to change the passphrase
   directly.
3. Update the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret to the new
   encrypted blob.
4. Create a new `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secret with
   the passphrase value.
5. Back up both the encrypted key and the passphrase to your password
   manager as separate entries.

Tradeoff: both the key and the passphrase need to be backed up together,
but someone who finds only one of them cannot sign.

### 3. Document who has access

Keep a note of which team members have admin access to the `MinervaMVP` repo
(ability to read/modify secrets). This is the current attack surface for the
key. Limit it to the minimum needed.

## Graceful rotation procedure

Use this to proactively rotate the key (e.g., annually, or when a team member
with admin access leaves). **Only works if you still have the current key.**

1. Generate a new keypair on a trusted machine:
   ```bash
   tauri signer generate -w ~/.tauri/minerva-new.key
   ```
   Note both the new private key and the new public key output.

2. Update `desktop_app/src-tauri/tauri.conf.json`:
   - Replace `plugins.updater.pubkey` with the **new** public key.

3. Do **not** yet update the `TAURI_SIGNING_PRIVATE_KEY` secret on GitHub.
   The next release must be signed with the **old** private key so existing
   installs accept it.

4. Bump the desktop app version, merge, and tag a release as normal. CI will
   sign this release with the old key; installed apps verify with their old
   embedded pubkey, install the update, and end up with the new pubkey
   embedded. Call this release a "transition release."

5. Verify at least one installed client has auto-updated successfully to the
   transition release.

6. Update the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret to the **new**
   private key. Update `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if using one.

7. Tag the next release as normal. CI signs it with the new key; clients
   running the transition release verify with the new pubkey they already
   have. Done.

8. Back up the new private key per the "Do these things now" section. Mark
   the old key as retired but keep it in your password manager for at least
   one release cycle in case you need to roll back.

## Emergency procedure: key lost

If `TAURI_SIGNING_PRIVATE_KEY` is deleted from GitHub and you have no backup,
auto-update is permanently broken for the current install base. You must:

1. Generate a fresh keypair.
2. Update `tauri.conf.json:plugins.updater.pubkey` to the new public key.
3. Set `TAURI_SIGNING_PRIVATE_KEY` to the new private key.
4. Tag a new release. CI will produce a signed MSI (and any other supported
   platforms) with the new pubkey embedded.
5. **Communicate to every installed user** that they need to manually
   download and install the new MSI from the releases page. Their existing
   app will not receive the update automatically.
6. Once installed, those apps will auto-update as normal going forward.

The pain here scales with install-base size. At 10 users it's a Slack message.
At 10k users it's a support crisis.

## Emergency procedure: key leaked

If the private key is exposed (committed to a public repo, pasted in a chat,
etc.), an attacker with the key plus the ability to host a malicious
`latest.json` can push arbitrary code to installed clients. Treat this as
urgent:

1. Immediately generate a new keypair and update `tauri.conf.json` +
   `TAURI_SIGNING_PRIVATE_KEY` secret.
2. Tag a legitimate new release as soon as possible. This release has the new
   pubkey embedded — users who install it are safe.
3. **You cannot revoke the leaked key for existing installs.** Until users
   reinstall, they remain vulnerable. Push them to upgrade via any channel
   you have (email, in-app notification if added later, website banner).
4. Audit logs for unusual update checks / download patterns if your hosting
   supports it.
5. Consider adding an explicit `check for updates` UI action with visible
   failure states, so users notice when updates stop working (currently the
   check is silent on failure).

## References

- Updater plugin documentation: https://tauri.app/plugin/updater/
- Tauri signer CLI: https://tauri.app/develop/updater/
- Related config: `desktop_app/src-tauri/tauri.conf.json` (`plugins.updater`)
- Related CI: `.github/workflows/desktop-release.yml`
