import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import https from 'node:https'
import net from 'node:net'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

// A profile-installed bundle cannot resolve dsh-shipped packages through Node's normal
// resolution, so load the tool helpers from the running installation itself.
async function loadDefineTool() {
  const relative = join('dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  const candidates = []
  const installDir = process.env.DSH_INSTALL_DIR
  if (installDir) candidates.push(join(installDir, '..', 'dsh-tools', 'lib', 'index.js'))
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'app.asar', relative))
    candidates.push(join(process.resourcesPath, 'app.asar.unpacked', relative))
    candidates.push(join(process.resourcesPath, 'app', relative))
  }
  const execDir = process.execPath ? dirname(process.execPath) : null
  if (execDir) {
    candidates.push(join(execDir, 'resources', 'app.asar', relative))
    candidates.push(join(execDir, 'resources', 'app.asar.unpacked', relative))
  }
  const tried = []
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {
        tried.push(candidate + ' (missing)')
        continue
      }
      const mod = await import(pathToFileURL(candidate).href)
      if (mod && typeof mod.defineTool === 'function') return mod.defineTool
      tried.push(candidate + ' (no defineTool)')
    } catch (error) {
      tried.push(candidate + ' (' + (error && error.message ? error.message : 'import failed') + ')')
    }
  }
  throw new Error('net-accelerator: cannot load @deepseek-ai/dsh-tools. Tried: ' + tried.join('; '))
}

const defineTool = await loadDefineTool()

const DEFAULTS = {
  steamExe: null,
  hostsPath: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
  proxyPort: 443,
  waitMs: 25000,
  testUrl: 'https://github.com/',
}

const STEAM_EXE_CANDIDATES = [
  'C:\\Program Files\\Steam++\\Steam++.exe',
  'C:\\Program Files (x86)\\Steam++\\Steam++.exe',
  'C:\\Program Files\\SteamTools\\Steam++.exe',
  'D:\\Program Files\\Steam++\\Steam++.exe',
  'D:\\Steam++\\Steam++.exe',
  'E:\\Steam++\\Steam++.exe',
]

function firstExistingCandidate() {
  for (const candidate of STEAM_EXE_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

// Watt Toolkit registers itself as "Watt Toolkit" in the uninstall keys. Prefer that
// installation over a leftover copy in a default directory.
async function detectSteamExeFromRegistry() {
  const script = [
    "$keys=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
    "$e=Get-ItemProperty $keys -ErrorAction SilentlyContinue",
    "| Where-Object { $_.DisplayName -match 'Watt Toolkit|Steam\\+\\+' } | Select-Object -First 1;",
    "if($e -and $e.UninstallString){",
    "$u=($e.UninstallString -replace '\"','').Trim();",
    "$d=Split-Path $u -Parent;",
    "if($d){ $c=Join-Path $d 'Steam++.exe'; if(Test-Path $c){ $c } }",
    "}",
  ].join(' ')
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 12000)
  const line = String(result.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  if (line && existsSync(line)) return line
  return null
}

function run(file, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || ''), error: error ? error.message : null })
    })
  })
}

async function readHosts(path) {
  try {
    return { ok: true, text: await readFile(path, 'utf8') }
  } catch (error) {
    return { ok: false, text: '', error: String(error && error.message ? error.message : error) }
  }
}

function hostsHasSteamBlock(text) {
  if (!text) return false
  return /#\s*Steam\+\+\s*Start/i.test(text)
}

function hostsHasGithub(text) {
  if (!text) return false
  return /^\s*127\.0\.0\.1\s+github\.com\s*$/im.test(text)
}

async function acceleratorRunning() {
  const r = await run('tasklist', ['/FI', 'IMAGENAME eq Steam++.Accelerator.exe', '/NH'])
  return /Steam\+\+\.Accelerator\.exe/i.test(r.stdout)
}

function portOpen(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function probeUrl(url, timeoutMs = 6000, signal) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    // The accelerator terminates TLS with its own SteamTools certificate, which Node's
    // bundled CA list does not contain, so the reachability probe accepts any certificate
    // and reports the peer subject instead. No content from this request is used.
    let req
    try {
      req = https.request(url, {
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: { 'user-agent': 'dsh-net-accelerator' },
      }, (res) => {
        let certCN = null
        let certIssuer = null
        try {
          const cert = res.socket && res.socket.getPeerCertificate ? res.socket.getPeerCertificate() : null
          if (cert && cert.subject) {
            certCN = cert.subject.CN || null
            certIssuer = cert.issuer ? (cert.issuer.CN || cert.issuer.O || null) : null
          }
        } catch {
          // certificate details are optional
        }
        res.resume()
        res.on('end', () => finish({
          reachable: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          ms: Date.now() - started,
          certCN,
          certIssuer,
          error: null,
        }))
        res.on('error', () => finish({ reachable: false, status: res.statusCode, ms: Date.now() - started, certCN, certIssuer, error: 'response error' }))
      })
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', (error) => finish({
        reachable: false,
        status: null,
        ms: Date.now() - started,
        certCN: null,
        certIssuer: null,
        error: String(error.code || error.message || error),
      }))
      if (signal) {
        signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
      }
      req.end()
    } catch (error) {
      finish({ reachable: false, status: null, ms: Date.now() - started, certCN: null, certIssuer: null, error: String(error.message || error) })
    }
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const name = 'net-accelerator'
export const inject = ['tools']

export function apply(ctx, config) {
  const options = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  let steamExe = null
  let steamExeResolved = false

  async function getSteamExe() {
    if (steamExeResolved) return steamExe
    steamExeResolved = true
    const configured = typeof options.steamExe === 'string' ? options.steamExe.trim() : ''
    if (configured) {
      steamExe = configured
      return steamExe
    }
    steamExe = (await detectSteamExeFromRegistry()) || firstExistingCandidate()
    return steamExe
  }

  async function snapshot(signal, probeTimeoutMs) {
    const hosts = await readHosts(options.hostsPath)
    const [processUp, proxyUp, probe] = await Promise.all([
      acceleratorRunning(),
      portOpen(options.proxyPort),
      probeUrl(options.testUrl, probeTimeoutMs, signal),
    ])
    const blockPresent = hosts.ok ? hostsHasSteamBlock(hosts.text) : false
    const githubMapped = hosts.ok ? hostsHasGithub(hosts.text) : false
    const viaSteamToolsCert = /steamtools/i.test(String(probe.certIssuer || ''))
      || /steamtools/i.test(String(probe.certCN || ''))
    return {
      hostsBlock: hosts.ok ? blockPresent : null,
      hostsGithub: hosts.ok ? githubMapped : null,
      hostsError: hosts.ok ? null : hosts.error,
      acceleratorProcess: processUp,
      localProxy: proxyUp,
      githubReachable: probe.reachable,
      githubMs: probe.ms,
      githubStatus: probe.status === undefined ? null : probe.status,
      githubError: probe.error || null,
      peerCertCN: probe.certCN || null,
      peerCertIssuer: probe.certIssuer || null,
      viaSteamToolsCert,
      accelerated: Boolean(blockPresent && (processUp || proxyUp) && probe.reachable),
    }
  }

  ctx.tools.register(defineTool({
    name: 'net_accelerate',
    description: 'Check or enable the Watt Toolkit (Steam++) network accelerator that unblocks github.com and other external sites on this machine. Call with action "ensure" before downloading from GitHub or other blocked hosts, and "status" when only the current state matters. "ensure" starts the Watt Toolkit executable when acceleration is off and waits for the local reverse proxy, then reports whether acceleration actually took effect; when it did not, a short hint explains what the user must click.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['status', 'ensure'],
        description: 'status reads the current state; ensure turns acceleration on when it is off.',
      },
      waitMs: {
        type: 'number',
        description: 'For action "ensure", how long to wait for the accelerator to come up, in milliseconds. Defaults to the configured value.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const action = args.action
      const waitMs = typeof args.waitMs === 'number' && args.waitMs > 0 ? args.waitMs : options.waitMs

      let state = await snapshot(exec.signal, action === 'ensure' ? 5000 : 6000)
      let startedApp = false
      const exe = await getSteamExe()

      if (action === 'ensure' && !state.accelerated && exe) {
        const hostRunning = await run('tasklist', ['/FI', 'IMAGENAME eq Steam++.exe', '/NH'])
        if (!/Steam\+\+\.exe/i.test(hostRunning.stdout)) {
          try {
            const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false })
            child.unref()
            startedApp = true
          } catch {
            startedApp = false
          }
        }
        const deadline = Date.now() + waitMs
        while (Date.now() < deadline) {
          await sleep(2000)
          state = await snapshot(exec.signal, 4000)
          if (state.accelerated) break
        }
      }

      const needsUserAction = action === 'ensure' && !state.accelerated
      let hint = null
      if (needsUserAction) {
        hint = exe
          ? 'Acceleration is still off. Ask the user to open Watt Toolkit and click the acceleration toggle, then call this tool again.'
          : 'Watt Toolkit was not found at any default location. Ask the user for the Steam++.exe path and set it in this plugin row config (steamExe).'
      }
      return {
        action,
        accelerated: state.accelerated,
        hostsBlock: state.hostsBlock,
        hostsGithub: state.hostsGithub,
        hostsError: state.hostsError,
        acceleratorProcess: state.acceleratorProcess,
        localProxy: state.localProxy,
        githubReachable: state.githubReachable,
        githubMs: state.githubMs,
        githubStatus: state.githubStatus,
        githubError: state.githubError,
        peerCertCN: state.peerCertCN,
        peerCertIssuer: state.peerCertIssuer,
        viaSteamToolsCert: state.viaSteamToolsCert,
        startedApp,
        needsUserAction,
        hint,
        steamExe: exe,
        testUrl: options.testUrl,
      }
    },
  }))
}
