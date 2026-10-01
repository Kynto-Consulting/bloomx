# @kyntocg/bloomx-cli

Command-line client for the **BloomX administration API**. It controls a BloomX instance (users, quotas, retention, sessions,
audit, security, branding/themes/landing, spam, extensions, mail import/export, system status...) from your terminal, over
**HTTPS**, with the same command engine as the web console at `/admin/profile/console`.

- Zero dependencies. Node 18 or later.
- Tokens are stored **only** in your user config directory with mode `0600` (never in a repo): `~/.config/bloomx/credentials.json`
  (Linux/macOS, honours `XDG_CONFIG_HOME`) or `%APPDATA%\bloomx\credentials.json` (Windows).
- Every command is audited on the server (with secrets redacted). Dangerous commands need `--yes` **and** a fresh password/MFA step-up.

> **About SSH.** `bloomx ssh` is an interactive shell **over HTTPS**. Real SSH (port 22) is not possible on Vercel, which only
> serves HTTP(S). See the "Admin CLI" page in the docs for how to offer real SSH with a gateway (not implemented).

## Install

```sh
npm i -g @kyntocg/bloomx-cli     # then: bloomx --help
# or, without installing:
npx @kyntocg/bloomx-cli login https://mail.example.com
```

## Log in

```sh
bloomx login https://mail.example.com
# asks for email, password (no echo) and the MFA code if your account has one
```

The account must be either an **administrator of that instance** (`ADMIN_EMAILS`, MFA required) or a **manager that owns the
instance's domain** on the shared backend. After login the CLI shows the domain the session is scoped to; **every command
operates only on that domain** (there is no `--domain` flag by design).

Options: `--email`, `--scopes read,write,security` (default `read,write`), `--ttl <hours>` (default 12, max 720),
`--name <label>`, `--password-stdin` (read the password from stdin, for automation), `--code <mfa>` / `BLOOMX_MFA_CODE`,
`--profile <name>`. Or skip the password entirely with a token created in the web console (`tokens create`):

```sh
bloomx login https://mail.example.com --token bxa_...
```

`bloomx logout` revokes the token on the server and deletes it locally (`--all` for every profile).

## Use

```sh
bloomx whoami                      # account, role, domain, scopes
bloomx users list --status disabled
bloomx users create ana@example.com --name "Ana"      # prints a temporary password once
bloomx audit --event "admin.users.*" --from 2026-01-01 --json | jq .
bloomx users export > users.csv
bloomx theme export > theme.json
bloomx theme import --file theme.json --dry-run
bloomx help                        # full catalogue, by category
bloomx help users sessions revoke  # one command
bloomx shell                       # interactive REPL (alias: bloomx ssh) with Tab completion and history
```

Pipes: `--json` prints raw data to stdout (errors go to stderr as JSON). `--file <path>` / `--stdin` supply JSON/CSV input to commands
that accept it. `--out <file>` writes the output to a file (mode `0600`).

Exit codes: `0` ok · `1` command error · `2` usage · `3` denied / not logged in · `4` needs confirmation or step-up ·
`5` rate limit / timeout · `6` network · `127` unknown command.

### Confirmation and step-up

`destructive` and `security` commands (disable users, revoke sessions, reset passwords/MFA, create tokens, retention runs...) need
`--yes` (or an interactive `y`) **and** re-authentication. In a terminal the CLI asks for your password, a 6-digit MFA code or a
recovery code (no echo); the proof is valid for 10 minutes and is bound to your account. For scripts set `BLOOMX_STEPUP_PASSWORD`
or `BLOOMX_STEPUP_CODE`.

### Several instances

```sh
bloomx login https://mail.acme.com
bloomx login https://mail.other.org
bloomx profiles
bloomx use mail.acme.com            # or: bloomx --profile mail.other.org users list
```

### Import / export mail

```sh
bloomx transfer export --scope domain --folders inbox,sent --confirm-domain example.com --yes
bloomx jobs watch <job>
bloomx transfer download <job> --out export.zip
bloomx transfer import backup.mbox        # chunked, resumable (--resume <job>), then: transfer import-confirm <job> --confirm-domain ... --yes
```

### Shell completion

```sh
source <(bloomx completion bash)    # or: bloomx completion zsh
```

## Environment

`BLOOMX_URL`, `BLOOMX_TOKEN`, `BLOOMX_PROFILE`, `BLOOMX_STEPUP_PASSWORD`, `BLOOMX_STEPUP_CODE`, `BLOOMX_MFA_CODE`,
`BLOOMX_CONFIG_DIR`, `BLOOMX_LANG` (`es`/`en`), `NO_COLOR`.

## Security notes

- Only `https://` URLs (`http://` only for `localhost`). Redirects are never followed, so the token cannot be sent elsewhere.
- Tokens are shown once, stored hashed (SHA-256) on the server, expire (12 h default, 30 d maximum), have scopes (`read`, `write`,
  `security`) and can be revoked at any time: `bloomx tokens list`, `bloomx tokens revoke <id>`.
- The CLI never executes system commands and never reads files other than the ones you pass with `--file`.

License: MIT.
