# Watt Toolkit accelerator

This plugin gives the agent one tool, `net_accelerate`, which reports and switches the
Watt Toolkit (Steam++) network accelerator on this machine.

## Why it exists

GitHub and several other external hosts are unreachable from some networks without the
accelerator. Watt Toolkit works by rewriting the Windows hosts file so accelerated domains
point at `127.0.0.1`, where its own reverse proxy listens on ports 80 and 443. Whether that
is live cannot be read from a single flag, so the plugin checks every signal itself.

## What the tool does

- `action: "status"` reads the hosts file for the `# Steam++ Start` block, checks whether
  `Steam++.Accelerator.exe` is running, tests the local proxy port, probes the configured
  test URL, and reports the peer certificate subject and issuer. It changes nothing.
- `action: "ensure"` does the same checks and, when acceleration is off, launches the Watt
  Toolkit executable, then polls for up to `waitMs` (25 s by default) until the proxy answers
  and the test URL is reachable.

The result reports each signal separately (`hostsBlock`, `acceleratorProcess`, `localProxy`,
`githubReachable`, `githubMs`, `peerCertCN`, `peerCertIssuer`, `viaSteamToolsCert`) plus a
single `accelerated` verdict. When `ensure` cannot finish on its own it returns
`needsUserAction: true` with a hint, because the toggle inside the Watt Toolkit window may
still need a click.

## Finding the executable

The executable path is resolved once per plugin instance: the row's `steamExe` config wins,
otherwise the plugin reads the uninstall registry entry (`Watt Toolkit`) and derives the
install directory, and only then falls back to a list of common directories. The registry
step exists because a machine can keep a stale copy in a default directory alongside the
registered installation, and guessing by directory name would launch the wrong one.

## Certificate handling

Watt Toolkit terminates TLS for accelerated hosts with its own root certificate
(`SteamTools Certificate`, installed in the Windows root store), so Node's bundled CA list
rejects it. The reachability probe therefore accepts any certificate and reports the peer
subject instead, and `viaSteamToolsCert` confirms the traffic really passes through Watt
Toolkit. No response body from the probe is used.

## Configuration

The row accepts overrides for `steamExe`, `hostsPath`, `proxyPort`, `waitMs`, and `testUrl`.

## Loading dsh helpers

A profile-installed bundle cannot resolve dsh-shipped packages through Node's module
resolution, so the plugin loads `defineTool` from the running installation at import time:
it tries `DSH_INSTALL_DIR` first and then locates the package under Electron's
`process.resourcesPath` (both `app.asar` and `app.asar.unpacked` layouts).

## Limits

Starting the executable does not guarantee the accelerator turns itself on; the plugin
reports that honestly instead of pretending success. It never edits the hosts file itself,
so turning acceleration off stays a job for Watt Toolkit.
