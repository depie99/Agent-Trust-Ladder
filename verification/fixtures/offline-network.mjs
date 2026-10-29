// Fail closed at real network boundaries while allowing local test servers.
import http from 'node:http';
import https from 'node:https';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
for (const transport of [http, https]) {
  const request = transport.request;
  transport.request = function (input, ...args) {
    const host = typeof input === 'string' || input instanceof URL ? new URL(input).hostname : input.hostname || input.host || 'localhost';
    if (!local(host)) throw new Error(`Offline test blocked network request to ${host}`);
    return request.call(this, input, ...args);
  };
}
const fetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!local(url.hostname)) return Promise.reject(new Error(`Offline test blocked fetch to ${url.hostname}`));
  return fetch(input, ...args);
};
const execFile = childProcess.execFile;
childProcess.execFile = function (command, ...args) {
  if (/^(gh|gh\.exe)$/i.test(command)) {
    const callback = args.at(-1);
    const error = new Error('Offline test blocked gh; run gh auth login outside the mock suite');
    error.code = 'ENOENT';
    if (typeof callback === 'function') { queueMicrotask(() => callback(error, '', error.message)); return { kill() {} }; }
    throw error;
  }
  return execFile.call(this, command, ...args);
};
childProcess.execFile[promisify.custom] = (...args) => new Promise((resolve, reject) => {
  childProcess.execFile(...args, (error, stdout, stderr) => {
    if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
    else resolve({ stdout, stderr });
  });
});
syncBuiltinESMExports();
