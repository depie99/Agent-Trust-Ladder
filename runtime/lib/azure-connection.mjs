import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Windows DPAPI encrypts for the current OS user. No PAT is put in argv,
// environment variables, project state, or the repository.
const defaultDir = () => path.join(os.homedir(), '.atl', 'connections');
export const azureIdentity = cfg => `${String(cfg?.org_url || '').replace(/\/$/, '').toLowerCase()}|${cfg?.project || ''}`;
export function protect(value, decrypt = false) {
  return new Promise((resolve, reject) => {
    const script = decrypt
      ? '$s=[Console]::In.ReadToEnd() | ConvertTo-SecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }'
      : '$s=ConvertTo-SecureString -String ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Write(($s | ConvertFrom-SecureString))';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
    child.once('error', () => reject(new Error('Windows credential encryption is unavailable.')));
    // Saving and unlocking fail for different reasons and need different
    // remedies: a host without usable DPAPI (headless/service contexts) can
    // still hold session credentials, while a remembered record that no
    // longer decrypts needs a reconnect.
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(decrypt
      ? 'Windows could not unlock this Azure connection. Reconnect from the UI.'
      : 'Windows credential protection is unavailable here — save the credential without "Remember securely" to keep it for this session.')));
    child.stdin.on('error', () => {}); child.stdin.end(value);
  });
}
// Some Windows contexts cannot use DPAPI at all (headless CI runners, service
// sessions): powershell.exe runs but the protect call exits non-zero. The
// offer to remember a credential must follow real capability, not the platform
// name, so the server asks once per process and caches the verdict.
let dpapiProbe = null;
export async function dpapiSupported() {
  if (process.platform !== 'win32') return false;
  dpapiProbe ||= protect('atl-dpapi-availability-probe').then(() => true, () => false);
  return dpapiProbe;
}
export async function saveAzureConnection(cfg, token, { dir = defaultDir() } = {}) {
  if (process.platform !== 'win32') throw new Error('Remembering Azure credentials requires Windows DPAPI on this installation. Use a session connection.');
  const encrypted = await protect(token);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'azure.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify({ version: 1, identity: azureIdentity(cfg), org_url: cfg.org_url, project: cfg.project, encrypted }), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
export async function readAzureConnection(cfg, { dir = defaultDir() } = {}) {
  const file = path.join(dir, 'azure.json');
  if (!fs.existsSync(file)) return null;
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.identity !== azureIdentity(cfg) || process.platform !== 'win32') return null;
  return protect(record.encrypted, true);
}
export function forgetAzureConnection(cfg, { dir = defaultDir() } = {}) {
  const file = path.join(dir, 'azure.json');
  if (!fs.existsSync(file)) return;
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.identity === azureIdentity(cfg)) fs.rmSync(file, { force: true });
}
