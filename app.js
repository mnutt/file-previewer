'use strict';

const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const port = Number(process.env.PORT || 8000);
const unoserverPort = Number(process.env.UNOSERVER_PORT || 2003);
const unoserverHost = process.env.UNOSERVER_HOST || '127.0.0.1';
const unoPort = Number(process.env.UNO_PORT || 2002);
const preBakedProfileCandidates = [
  '/opt/app/.sandstorm/libreoffice-profile',
];
const runtimeProfileDir = '/tmp/libreoffice-config';
const runtimeHomeDir = '/tmp/libreoffice-home';
const verboseTiming = process.env.VERBOSE_TIMING === '1';
let unoserverProc = null;
let unoserverReadyPromise = null;
let nextRequestId = 1;
const maxUploadBytes = 20 * 1024 * 1024;
const supportedExtensions = new Set(['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']);
const pdfFilterOptions = [
  'ReduceImageResolution=true',
  'MaxImageResolution=150',
  'Quality=75',
  'UseTaggedPDF=false',
  'ExportBookmarks=false',
];

function log(level, message, details) {
  const ts = new Date().toISOString();
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[${ts}] [${level}] ${message}${suffix}`);
}

function nowNs() {
  return process.hrtime.bigint();
}

function elapsedMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

function libreOfficeEnv() {
  ensureRuntimeProfile();
  const existingLd = process.env.LD_LIBRARY_PATH || '';
  const loLd = '/usr/lib/libreoffice/program';
  const salLog = process.env.SAL_LOG || '+WARN';
  return {
    ...process.env,
    HOME: runtimeHomeDir,
    UserInstallation: `file://${runtimeProfileDir}`,
    LD_LIBRARY_PATH: existingLd ? `${loLd}:${existingLd}` : loLd,
    JAVA_HOME: '',
    LO_JAVA_ENABLED: 'false',
    SAL_USE_VCLPLUGIN: 'svp',
    OOO_FORCE_DESKTOP: 'none',
    LANG: 'C',
    LC_ALL: 'C',
    SAL_LOG: salLog,
  };
}

function writeOrPatchRegistryModifications(profileDir) {
  const file = path.join(profileDir, 'registrymodifications.xcu');
  const disableItems = [
    '<item oor:path="/org.openoffice.Office.Linguistic/General"><prop oor:name="IsSpellAuto" oor:op="fuse"><value>false</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Linguistic/General"><prop oor:name="IsGrammarAuto" oor:op="fuse"><value>false</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Linguistic/General"><prop oor:name="IsHyphAuto" oor:op="fuse"><value>false</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Common/AutoCorrect"><prop oor:name="EnableAutocorrection" oor:op="fuse"><value>false</value></prop></item>',
  ];

  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    current =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<oor:items xmlns:oor="http://openoffice.org/2001/registry" ' +
      'xmlns:xs="http://www.w3.org/2001/XMLSchema" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
      '</oor:items>\n';
  }

  let updated = current;
  for (const item of disableItems) {
    if (!updated.includes(item)) {
      if (updated.includes('</oor:items>')) {
        updated = updated.replace('</oor:items>', `${item}\n</oor:items>`);
      } else {
        updated += `\n${item}\n`;
      }
    }
  }

  if (updated !== current) {
    fs.writeFileSync(file, updated, 'utf8');
    log('INFO', 'Patched LibreOffice profile for aggressive no-linguistics mode', {
      profileDir,
      file,
    });
  }
}

function ensureRuntimeProfile() {
  fs.mkdirSync(runtimeHomeDir, { recursive: true });
  if (fs.existsSync(path.join(runtimeProfileDir, '.seeded'))) return;

  const preBakedProfileDir = preBakedProfileCandidates.find((p) => fs.existsSync(p));
  if (preBakedProfileDir) {
    fs.rmSync(runtimeProfileDir, { recursive: true, force: true });
    fs.cpSync(preBakedProfileDir, runtimeProfileDir, { recursive: true });
    writeOrPatchRegistryModifications(runtimeProfileDir);
    fs.writeFileSync(path.join(runtimeProfileDir, '.seeded'), '1');
    if (verboseTiming) {
      log('INFO', 'Seeded runtime LibreOffice profile from image', {
        source: preBakedProfileDir,
        target: runtimeProfileDir,
      });
    }
    return;
  }

  fs.mkdirSync(runtimeProfileDir, { recursive: true });
  writeOrPatchRegistryModifications(runtimeProfileDir);
  fs.writeFileSync(path.join(runtimeProfileDir, '.seeded'), '1');
  log('WARN', 'Pre-baked LibreOffice profile not found; using empty runtime profile', {
    target: runtimeProfileDir,
  });
}

function spawnAndCapture(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, options);
    const stdout = [];
    const stderr = [];

    proc.stdout.on('data', (chunk) => stdout.push(chunk));
    proc.stderr.on('data', (chunk) => stderr.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function waitForUnoserver(timeoutMs = 30000) {
  const start = nowNs();
  let attempt = 0;
  while (elapsedMs(start) < timeoutMs) {
    attempt += 1;
    const pingStart = nowNs();
    const result = await spawnAndCapture(
      'unoping',
      ['--host', unoserverHost, '--port', String(unoserverPort)],
      { env: libreOfficeEnv() }
    );
    if (verboseTiming) {
      log('INFO', 'unoping attempt', {
        attempt,
        code: result.code,
        pingMs: Number(elapsedMs(pingStart).toFixed(1)),
        totalWaitMs: Number(elapsedMs(start).toFixed(1)),
      });
    }
    if (result.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('unoserver did not become ready within timeout');
}

async function ensureUnoserver() {
  if (unoserverReadyPromise) return unoserverReadyPromise;

  unoserverReadyPromise = (async () => {
    const start = nowNs();
    log('INFO', 'Starting unoserver', {
      host: unoserverHost,
      port: unoserverPort,
      unoPort,
    });

    const args = [
      '--interface',
      unoserverHost,
      '--port',
      String(unoserverPort),
      '--uno-interface',
      unoserverHost,
      '--uno-port',
      String(unoPort),
      '--user-installation',
      runtimeProfileDir,
    ];

    unoserverProc = spawn('unoserver', args, { env: libreOfficeEnv() });
    if (verboseTiming) {
      log('INFO', 'unoserver process spawned', { pid: unoserverProc.pid });
    }
    unoserverProc.stdout.on('data', (chunk) => {
      if (verboseTiming) {
        log('INFO', 'unoserver stdout', { output: chunk.toString('utf8').trim() });
      }
    });
    unoserverProc.stderr.on('data', (chunk) => {
      const output = chunk.toString('utf8').trim();
      if (output.startsWith('INFO:')) {
        if (verboseTiming) log('INFO', 'unoserver stderr', { output });
        return;
      }
      log('WARN', 'unoserver stderr', { output });
    });
    unoserverProc.on('exit', (code, signal) => {
      log('ERROR', 'unoserver exited', { code, signal });
      unoserverProc = null;
      unoserverReadyPromise = null;
    });
    unoserverProc.on('error', (err) => {
      log('ERROR', 'unoserver failed to start', { error: err.message });
      unoserverProc = null;
      unoserverReadyPromise = null;
    });

    await waitForUnoserver(45000);
    log('INFO', 'unoserver ready', {
      host: unoserverHost,
      port: unoserverPort,
      startupMs: Number(elapsedMs(start).toFixed(1)),
    });
  })();

  return unoserverReadyPromise;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
  },
});
const rawUpload = express.raw({
  type: () => true,
  limit: maxUploadBytes,
});

function convertToPdf(buffer, context) {
  return new Promise((resolve, reject) => {
    const conversionStart = nowNs();

    ensureUnoserver()
      .then(() => {
        const ensureDoneMs = Number(elapsedMs(conversionStart).toFixed(1));
        if (verboseTiming) log('INFO', 'Starting unoconvert conversion', context);
        if (verboseTiming) {
          log('INFO', 'Conversion phase timing', {
            ...context,
            phase: 'afterEnsureUnoserver',
            elapsedMs: ensureDoneMs,
          });
        }

        const spawnStart = nowNs();
        const filterArgs = pdfFilterOptions.flatMap((option) => ['--filter-option', option]);
        const proc = spawn(
          'unoconvert',
          [
            '--host',
            unoserverHost,
            '--port',
            String(unoserverPort),
            '--host-location',
            'remote',
            '--dont-update-index',
            '--convert-to',
            'pdf',
            ...filterArgs,
            '-',
            '-',
          ],
          { env: libreOfficeEnv() }
        );
        if (verboseTiming) {
          log('INFO', 'unoconvert process spawned', {
            ...context,
            pid: proc.pid,
          });
        }

        const stdout = [];
        const stderr = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let firstStdoutLogged = false;
        let firstStderrLogged = false;
        let settled = false;

        function failOnce(err) {
          if (settled) return;
          settled = true;
          reject(err);
        }

        function resolveOnce(value) {
          if (settled) return;
          settled = true;
          resolve(value);
        }

        const timeout = setTimeout(() => {
          log('ERROR', 'unoconvert conversion timed out', context);
          proc.kill('SIGKILL');
          failOnce(new Error('Document conversion timed out.'));
        }, 90000);

        proc.stdout.on('data', (chunk) => {
          stdout.push(chunk);
          stdoutBytes += chunk.length;
          if (verboseTiming && !firstStdoutLogged) {
            firstStdoutLogged = true;
            log('INFO', 'unoconvert first stdout chunk', {
              ...context,
              elapsedMs: Number(elapsedMs(spawnStart).toFixed(1)),
              chunkBytes: chunk.length,
            });
          }
        });
        proc.stderr.on('data', (chunk) => {
          stderr.push(chunk);
          stderrBytes += chunk.length;
          if (verboseTiming && !firstStderrLogged) {
            firstStderrLogged = true;
            log('INFO', 'unoconvert first stderr chunk', {
              ...context,
              elapsedMs: Number(elapsedMs(spawnStart).toFixed(1)),
              chunkBytes: chunk.length,
            });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          log('ERROR', 'Failed to start unoconvert', {
            ...context,
            error: err.message,
          });
          failOnce(err);
        });

        proc.on('close', (code) => {
          clearTimeout(timeout);
          const stderrText = Buffer.concat(stderr).toString('utf8').trim();
          if (stderrText) {
            if (verboseTiming) {
              log('WARN', 'unoconvert stderr output', {
                ...context,
                stderr: stderrText,
              });
            }
          }

          if (code !== 0) {
            log('ERROR', 'unoconvert conversion failed', {
              ...context,
              exitCode: code,
              elapsedMs: Number(elapsedMs(spawnStart).toFixed(1)),
            });
            failOnce(new Error(stderrText || `unoconvert exited with code ${code}`));
            return;
          }

          const pdf = Buffer.concat(stdout);
          if (verboseTiming) {
            log('INFO', 'unoconvert conversion succeeded', {
              ...context,
              pdfBytes: pdf.length,
              spawnToExitMs: Number(elapsedMs(spawnStart).toFixed(1)),
              totalConversionMs: Number(elapsedMs(conversionStart).toFixed(1)),
              stdoutBytes,
              stderrBytes,
            });
          }
          resolveOnce(pdf);
        });

        proc.stdin.on('error', (err) => {
          clearTimeout(timeout);
          log('ERROR', 'Failed writing input to unoconvert', {
            ...context,
            error: err.message,
          });
          failOnce(err);
        });

        proc.stdin.end(buffer, () => {
          if (verboseTiming) {
            log('INFO', 'unoconvert stdin fully written', {
              ...context,
              inputBytes: buffer.length,
              elapsedMs: Number(elapsedMs(spawnStart).toFixed(1)),
            });
          }
        });
      })
      .catch((err) => reject(err));
  });
}

function supportedExtensionsText() {
  return Array.from(supportedExtensions).join(', ');
}

function extensionFor(filename) {
  return path.extname(filename || '').toLowerCase();
}

function normalizeFilename(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^['"]+|['"]+$/g, '');
}

function selectFilename(candidates, fallback = 'upload') {
  const normalized = candidates.map(normalizeFilename).filter(Boolean);
  if (normalized.length === 0) return fallback;
  return normalized[0];
}

function quotedFilename(filename) {
  return String(filename || 'preview.pdf').replace(/["\r\n]/g, '_');
}

function pdfFilenameFor(originalName) {
  const base = path.basename(originalName || 'preview', extensionFor(originalName || 'preview'));
  return `${base || 'preview'}.pdf`;
}

function fileFromMultipart(req) {
  if (!req.file) return null;
  return {
    buffer: req.file.buffer,
    filename: req.file.originalname || 'upload',
    sizeBytes: req.file.size,
    mimeType: req.file.mimetype || 'unknown',
  };
}

function fileFromRawRequest(req) {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return null;
  const headerName = req.get('x-sandstorm-app-filename');
  const filename = selectFilename([headerName], 'upload');
  return {
    buffer: req.body,
    filename,
    sizeBytes: req.body.length,
    mimeType: req.get('content-type') || 'application/octet-stream',
  };
}

function parseUpload(req, res, next) {
  if (req.is('multipart/form-data')) {
    upload.single('file')(req, res, next);
    return;
  }
  rawUpload(req, res, next);
}

function redactedHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function handleConversionRequest(req, res, uploadInfo, source) {
  let context = { requestId: req.requestId, source };
  try {
    if (!uploadInfo) {
      log('WARN', 'Preview request missing file', context);
      res.status(400).send('Missing file data.');
      return;
    }

    const ext = extensionFor(uploadInfo.filename);
    context = {
      ...context,
      filename: uploadInfo.filename,
      extension: ext,
      sizeBytes: uploadInfo.sizeBytes,
      mimeType: uploadInfo.mimeType,
      sandstormSessionType: req.get('x-sandstorm-session-type') || 'normal',
      sandstormApi: req.get('x-sandstorm-api') || null,
    };

    if (verboseTiming) log('INFO', 'Received upload', context);

    if (!supportedExtensions.has(ext)) {
      log('WARN', 'Rejected unsupported upload', context);
      res.status(400).send(`Supported extensions: ${supportedExtensionsText()}`);
      return;
    }

    const pdf = await convertToPdf(uploadInfo.buffer, context);
    res.set('Content-Disposition', `inline; filename="${quotedFilename(pdfFilenameFor(uploadInfo.filename))}"`);
    res.set('Content-Length', String(pdf.length));
    res.type('application/pdf').send(pdf);
  } catch (err) {
    log('ERROR', 'Preview request failed', {
      requestId: req.requestId,
      source,
      error: err.message,
    });
    res.status(500).send('Preview failed. Please try again.');
  }
}

app.use(express.static('public'));
app.use((req, _res, next) => {
  req.requestId = nextRequestId++;
  next();
});

app.post(['/api/preview', /^\/api\/preview\/+$/], parseUpload, async (req, res) => {
  log('INFO', 'Incoming preview request headers', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    headers: redactedHeaders(req.headers),
  });
  const uploadInfo = fileFromMultipart(req) || fileFromRawRequest(req);
  const source = req.get('x-sandstorm-session-type') === 'api' ? 'powerbox-api' : 'web-upload';
  await handleConversionRequest(req, res, uploadInfo, source);
});

app.listen(port, () => {
  log('INFO', 'Previewer listening', {
    port,
    nodeVersion: process.version,
  });
  ensureUnoserver().catch((err) => {
    log('ERROR', 'Unable to initialize unoserver at startup', {
      error: err.message,
    });
  });
});

function shutdown() {
  if (unoserverProc && !unoserverProc.killed) {
    log('INFO', 'Stopping unoserver');
    unoserverProc.kill('SIGTERM');
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
