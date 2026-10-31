import assert from 'node:assert/strict';
import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {validateConfig, preparedSchedule} from './workload.js';

const reasons = new Set(['invalid_request','duplicate_ordinal','auth_failed','deadline','participant_disconnect','clock_inconsistent','token_lifetime','child_exit','cancelled','gate_error']);

// Coordination only: every backend request still goes directly from its VU's official SDK.
export async function startPreparedGate({runId, config, onEvent = () => {}, onFailure = () => {}}) {
  assert.match(runId, /^social-[A-Za-z0-9]{6}$/);
  validateConfig(config); assert.equal(config.version, 'social-prepared-v1');
  const began = performance.now(), wall = Date.now(), entries = new Map(), queue = [];
  let active = null, lastAdmission = -Infinity, status = 'preparing', reason = null, releaseAt = null, finishedAt = null, pumpTimer, deadline, closing;
  const elapsed = () => performance.now() - began;
  const emit = (event, fields = {}) => onEvent({event, at: wall + elapsed(), elapsedMs: elapsed(), ...fields});
  const snapshot = () => ({status, reason, expectedUsers:config.vus, admittedUsers:[...entries.values()].filter(e => e.admitted).length, readyUsers:[...entries.values()].filter(e => e.ready).length, elapsedMs:finishedAt ?? elapsed(), releaseAt, loginsPerSecond:config.authPreparation.loginsPerSecond, concurrency:1, timeoutSeconds:config.authPreparation.timeoutSeconds});
  const respond = (res, code, value) => { if (!res.destroyed && !res.writableEnded) { res.writeHead(code, {'content-type':'application/json',connection:'close'}); res.end(JSON.stringify(value)); } };
  const stopTimers = () => { clearTimeout(pumpTimer); clearTimeout(deadline); };
  const fail = value => {
    assert.ok(reasons.has(value));
    if (status !== 'preparing') return;
    status = 'failed'; reason = value; releaseAt = null; finishedAt = elapsed(); stopTimers(); emit('failed', {reason});
    for (const e of entries.values()) if (e.response) respond(e.response, 503, {reason});
    onFailure(reason);
  };
  const clockValid = () => {
    const reason=elapsed()>=config.authPreparation.timeoutSeconds*1000?'deadline':Math.abs(Date.now()-wall-elapsed())>100?'clock_inconsistent':null;
    if(reason)fail(reason);
    return reason===null;
  };
  const pump = () => {
    if (status !== 'preparing' || active !== null || !queue.length) return;
    if (!clockValid()) return;
    const wait = 1000 / config.authPreparation.loginsPerSecond - (elapsed() - lastAdmission);
    if (wait > 0) { pumpTimer = setTimeout(pump, Math.ceil(wait)); return; }
    const e = queue.shift(); active = e.ordinal; lastAdmission = elapsed(); e.admitted = true;
    emit('admitted', {ordinal:e.ordinal}); respond(e.response, 200, {admitted:true}); e.response = null;
  };
  const release = () => {
    if (status !== 'preparing' || active !== null || [...entries.values()].filter(e => e.ready).length !== config.vus) return;
    if (!clockValid()) return;
    releaseAt = Math.ceil(wall + elapsed() + 2000);
    if ([...entries.values()].some(e => e.expiresAtMs <= preparedSchedule(config,releaseAt,e.ordinal).activationAt + 10000)) { releaseAt = null; fail('token_lifetime'); return; }
    if (!clockValid()) return;
    status = 'released'; finishedAt = elapsed(); stopTimers(); emit('released', {releaseAt});
    for (const e of entries.values()) respond(e.response, 200, {releaseAt});
    void close();
  };
  const server = http.createServer(async (req,res) => {
    try {
      if (status !== 'preparing') { respond(res,503,{reason:reason ?? 'closed'}); return; }
      if (req.method !== 'POST' || !['/admit','/ready','/failed'].includes(req.url) || req.headers['content-type'] !== 'application/json') throw new Error();
      let body = '', bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 512) throw new Error(); body += chunk; }
      const value = JSON.parse(body), ordinal = value?.ordinal;
      const fields = req.url === '/ready' ? ['runId','ordinal','loginAtMs','expiresAtMs','ttlSeconds'] : req.url === '/failed' ? ['runId','ordinal','reason'] : ['runId','ordinal'];
      if (!value || Array.isArray(value) || Object.keys(value).length !== fields.length || !fields.every(k => Object.hasOwn(value,k)) || value.runId !== runId || !Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > config.vus) throw new Error();
      if (!clockValid()) { respond(res,503,{reason}); return; }
      if (req.url === '/admit') {
        if (entries.has(ordinal)) { fail('duplicate_ordinal'); respond(res,409,{reason}); return; }
        const entry = {ordinal, response:res, admitted:false, ready:false}; entries.set(ordinal,entry); queue.push(entry); emit('queued',{ordinal});
      } else {
        const entry = entries.get(ordinal);
        if (!entry?.admitted || entry.ready || active !== ordinal) throw new Error();
        if (req.url === '/failed') { if (value.reason !== 'auth_failed') throw new Error(); fail('auth_failed'); respond(res,503,{reason}); return; }
        if (![value.loginAtMs,value.expiresAtMs].every(n => Number.isFinite(n) && n > 0) || value.ttlSeconds !== null && (!Number.isFinite(value.ttlSeconds) || value.ttlSeconds <= 0 || value.expiresAtMs-value.loginAtMs > value.ttlSeconds*1000+2000) || value.loginAtMs > Date.now()+100 || value.loginAtMs < wall-100 || value.expiresAtMs <= value.loginAtMs) throw new Error();
        Object.assign(entry,{ready:true,response:res,loginAtMs:value.loginAtMs,expiresAtMs:value.expiresAtMs,ttlSeconds:value.ttlSeconds}); active = null;
        emit('ready',{ordinal,loginAtMs:value.loginAtMs,expiresAtMs:value.expiresAtMs,ttlSeconds:value.ttlSeconds});
      }
      res.once('close',()=>{ if (!res.writableEnded) fail('participant_disconnect'); });
      pump(); release();
    } catch { fail('invalid_request'); respond(res,400,{reason:'invalid_request'}); }
  });
  server.requestTimeout = Math.ceil(config.authPreparation.timeoutSeconds*1000)+5000;
  server.headersTimeout = Math.min(server.requestTimeout,10000);
  server.maxConnections = config.vus+1;
  server.on('clientError', (_error,socket) => { fail('invalid_request'); socket.destroy(); });
  server.on('error', () => fail('gate_error'));
  const close = async (why) => {
    if (why || status === 'preparing') fail(why ?? 'cancelled');
    stopTimers();
    if (!closing) closing = new Promise(resolve => {
      const force = setTimeout(()=>server.closeAllConnections(),1000);
      server.close(()=>{clearTimeout(force);emit('closed',{status});resolve();});
      server.closeIdleConnections();
    });
    return closing;
  };
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  emit('started',{runId,expectedUsers:config.vus,loginsPerSecond:config.authPreparation.loginsPerSecond,timeoutSeconds:config.authPreparation.timeoutSeconds});
  deadline = setTimeout(()=>fail('deadline'),Math.max(1,config.authPreparation.timeoutSeconds*1000-elapsed()));
  return {origin:`http://127.0.0.1:${server.address().port}`,snapshot,close,fail};
}
