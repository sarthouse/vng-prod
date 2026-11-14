import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../src/core/logger.js';

test('Logger escribe en app-*.log y error-*.log filtrando por nivel', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vng-logger-'));
  try {
    const log = createLogger('TEST', {
      level: 'warn',
      console: false,
      toFile: true,
      logDir: tmpDir,
    });

    log.debug('no debe aparecer');
    log.info('tampoco debe aparecer');
    log.warn('advertencia de prueba', { modulo: 'caja' });
    log.error('falla de prueba', new Error('boom'), { codigo: 500 });

    const today = new Date().toISOString().slice(0, 10);
    const appLog = fs.readFileSync(path.join(tmpDir, `app-${today}.log`), 'utf8');
    const errLog = fs.readFileSync(path.join(tmpDir, `error-${today}.log`), 'utf8');

    assert.equal(appLog.includes('no debe aparecer'), false);
    assert.equal(appLog.includes('tampoco debe aparecer'), false);
    assert.match(appLog, /\[WARN\]\[TEST\] advertencia de prueba \{"modulo":"caja"\}/);
    assert.match(appLog, /\[ERROR\]\[TEST\] falla de prueba \{"codigo":500\}/);
    assert.match(appLog, /Error: boom/);

    assert.equal(errLog.includes('advertencia de prueba'), false);
    assert.match(errLog, /\[ERROR\]\[TEST\] falla de prueba/);
    assert.match(errLog, /Error: boom/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Logger child concatena contexto', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vng-logger-child-'));
  try {
    const log = createLogger('HTTP', {
      level: 'info',
      console: false,
      toFile: true,
      logDir: tmpDir,
    }).child('API');

    log.info('ping');

    const today = new Date().toISOString().slice(0, 10);
    const appLog = fs.readFileSync(path.join(tmpDir, `app-${today}.log`), 'utf8');
    assert.match(appLog, /\[INFO\]\[HTTP:API\] ping/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
