#!/usr/bin/env node
// spawn-worker/status.mjs — kompakter Status von Hintergrund-Sitzungen für das Brain.
//   node status.mjs                              alle Hintergrund-Sitzungen (eine JSON-Zeile)
//   node status.mjs --id <id>                    eine Sitzung inkl. letzter Antwort bzw. Plan-Datei
//   node status.mjs --wait <id> [--timeout <s>] [--interval <s>]
//                                                wartet, bis die Sitzung fertig ist oder hängt (Exit 0);
//                                                Exit 3 = Zeitüberschreitung, Exit 4 = Sitzung unbekannt
//   node status.mjs --logs <id> [--lines <n>]    letzte Bildschirmzeilen ohne Steuerzeichen
//   node status.mjs --remove <id>                stoppen, entfernen und das Zuschau-Fenster schließen
//   node status.mjs --send <id> (--message <text> | --message-file <datei>) [--effort <stufe>]
//                                                einer fertigen oder wartenden Sitzung antworten; sie arbeitet mit
//                                                ihrem ganzen Verlauf weiter, unter einer neuen Kennung (Ausgabe: id)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const GRACE_MS = 20000; // direkt nach dem Start kann eine Sitzung kurz „idle" melden, bevor sie loslegt
const MAX_MESSAGE = 2000;

function out(obj, code = 0) { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) out({ ok: false, error: `Unerwartetes Argument: ${k}` }, 2);
    a[k.slice(2)] = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return a;
}

function agents() {
  const r = spawnSync('claude', ['agents', '--json', '--all'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

// Ende-Zustände: fertig (done), wartet auf Rückfrage (blocked), abgebrochen (failed), gestoppt (stopped). Ohne die
// letzten beiden wartete --wait bei einem abgebrochenen Worker bis zum Zeitlimit.
const END_STATES = ['done', 'blocked', 'failed', 'stopped'];
function finished(e) { return !e || END_STATES.includes(e.state) || e.status === 'idle' || e.status === 'waiting'; }

function transcriptPath(sessionId) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  try {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, `${sessionId}.jsonl`);
      if (fs.existsSync(p)) return p;
    }
  } catch { /* kein Projektordner */ }
  return null;
}

// Der Plan-Pfad steht je nach Zeitpunkt an verschiedenen Stellen im Transkript (Anhang beim Eintritt
// in den Planungsmodus, später als Eingabe von ExitPlanMode) — deshalb schlüsselbasiert suchen.
function findKey(o, key, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  if (typeof o[key] === 'string') return o[key];
  for (const v of Object.values(o)) { const f = findKey(v, key, depth + 1); if (f) return f; }
  return null;
}

function details(e) {
  const t = e.sessionId ? transcriptPath(e.sessionId) : null;
  let lastMessage = null;
  let planFile = null;
  if (t) {
    for (const line of fs.readFileSync(t, 'utf8').split('\n')) {
      if (!line) continue;
      let l;
      try { l = JSON.parse(line); } catch { continue; }
      if (line.includes('planFilePath')) planFile = findKey(l, 'planFilePath') || planFile;
      const c = l.message && l.message.content;
      if (l.type !== 'assistant' || !Array.isArray(c)) continue;
      const text = c.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) lastMessage = text;
    }
  }
  if (lastMessage && lastMessage.length > MAX_MESSAGE) lastMessage = lastMessage.slice(0, MAX_MESSAGE) + ' […gekürzt]';
  return {
    ok: true, id: e.id, name: e.name || null, status: e.status || null, state: e.state || null,
    waitingFor: e.waitingFor || null, cwd: e.cwd || null,
    // „fertig geplant" = der Planer wartet auf die Plan-Freigabe und die Plan-Datei liegt vor
    planFile, planReady: !!planFile && e.state === 'blocked' && fs.existsSync(planFile), lastMessage, transcript: t,
  };
}

function strip(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\r/g, '');
}

// Zuschau-Fenster von `spawn.mjs --watch` mit schließen: genau die PowerShell, deren
// Befehlszeile `claude attach <id>` enthält; die Kennung muss dort enden, damit abc123 nicht abc1234 trifft. Die
// abfragende PowerShell trägt dasselbe Muster in ihrer Befehlszeile und nimmt sich deshalb selbst aus ($PID).
function fensterSchliessen(id) {
  const ps = `$n = 0; Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'claude attach ${id}([^0-9a-f]|$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; $n`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const n = Number(String(r.stdout || '').trim());
  return Number.isInteger(n) ? n : null;
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

const a = parseArgs(process.argv.slice(2));
for (const k of ['id', 'wait', 'logs', 'remove', 'send']) {
  if (k in a && (typeof a[k] !== 'string' || !/^[0-9a-f]{6,}$/.test(a[k]))) out({ ok: false, error: `--${k} braucht eine Sitzungs-Kennung` }, 2);
}

// Einer Sitzung antworten, statt sie neu zu starten: `claude --bg --resume <sessionId> <nachricht>` setzt sie mit ihrem
// ganzen Verlauf fort. Solange die Sitzung registriert ist, legt die CLI dafür eine Kopie mit neuer Kennung an; Modell
// und Modus bleiben erhalten (belegt 13.11.2026, CLI 2.1.323). Die Worker-Settings des Starts (MCP, Auto-Compact,
// Merge-Freigabe) gibt dieser Befehl erneut mit. Das Original bleibt stehen und wird am Ende mit entfernt.
if (a.send) {
  const id = String(a.send);
  const list = agents() || [];
  const e = list.find((x) => x.id === id);
  if (!e || !e.sessionId) out({ ok: false, error: `Sitzung ${id} unbekannt` }, 4);
  if (e.state === 'working' || e.status === 'busy') out({ ok: false, error: `Sitzung ${id} arbeitet noch; erst mit --wait auf ihr Ende warten (eine Kopie wäre ein zweiter Schreiber im selben Ordner)` }, 2);
  if ((typeof a.message === 'string') === (typeof a['message-file'] === 'string')) out({ ok: false, error: 'Genau eins von --message <text> oder --message-file <datei> angeben' }, 2);
  let message;
  if (typeof a.message === 'string') message = a.message;
  else { try { message = fs.readFileSync(path.resolve(a['message-file']), 'utf8'); } catch { out({ ok: false, error: `Nachrichten-Datei nicht lesbar: ${a['message-file']}` }, 2); } }
  message = message.replace(/^﻿/, '').replace(/\s+$/, '');
  if (!message) out({ ok: false, error: 'Nachricht ist leer' }, 2);
  if (message.startsWith('-')) out({ ok: false, error: 'Nachricht darf nicht mit "-" beginnen (würde als Option gelesen)' }, 2);
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  if ('effort' in a && !efforts.includes(a.effort)) out({ ok: false, error: `--effort muss eins von ${efforts.join(', ')} sein` }, 2);
  if (!e.cwd || !fs.existsSync(e.cwd)) out({ ok: false, error: `Arbeitsordner der Sitzung fehlt: ${e.cwd}` }, 2);

  // Name der Fortsetzung: <name>-f2, -f3, … damit sie in der Übersicht zum Original gehört.
  const base = String(e.name || '').replace(/-f\d+$/, '');
  const n = (/-f(\d+)$/.exec(String(e.name || '')) || [0, 1])[1];
  const name = `${base}-f${Number(n) + 1}`;
  const nameOk = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(name) && !list.some((x) => x.name === name);

  // Jüngste Settings-Datei, die spawn.mjs für diesen Worker geschrieben hat (<name>-<zeit>.settings.json, 7 Tage haltbar).
  let settingsFile = null;
  try {
    const tmp = path.join(os.tmpdir(), 'spawn-worker');
    const passt = fs.readdirSync(tmp).filter((f) => f.startsWith(`${base}-`) && /^\d+\.settings\.json$/.test(f.slice(base.length + 1)));
    passt.sort((x, y) => fs.statSync(path.join(tmp, y)).mtimeMs - fs.statSync(path.join(tmp, x)).mtimeMs);
    if (base && passt.length) settingsFile = path.join(tmp, passt[0]);
  } catch { /* ohne Settings-Datei fortsetzen */ }

  const args = ['--bg', '--resume', e.sessionId];
  if (nameOk) args.push('--name', name);
  if (a.effort) args.push('--effort', a.effort);
  if (settingsFile) args.push('--settings', settingsFile);
  args.push(message);
  const r = spawnSync('claude', args, { cwd: e.cwd, encoding: 'utf8', windowsHide: true, timeout: 90000 });
  const text = strip(`${r.stdout || ''}${r.stderr || ''}`);
  const m = text.match(/backgrounded\s+·\s+([0-9a-f]{6,})/);
  if (!m) out({ ok: false, error: 'Fortsetzen fehlgeschlagen', output: text.trim().slice(0, 800), exitCode: r.status, hinweis: 'Vor einem neuen Versuch mit status.mjs prüfen, ob eine Kopie trotzdem läuft' }, 2);
  const neu = m[1];
  const self = process.argv[1];
  out({
    ok: true, id: neu, vorher: id, kopie: neu !== id, name: nameOk ? name : null, settingsFile, cwd: e.cwd,
    hinweis: neu !== id ? `Die Arbeit läuft unter ${neu} weiter; ${id} bleibt als Original stehen und wird am Ende mit entfernt` : null,
    next: { wait: `node "${self}" --wait ${neu}`, remove: `node "${self}" --remove ${neu}`, removeOriginal: `node "${self}" --remove ${id}` },
  });
}

// Stoppen und entfernen in einem Schritt. `claude rm` braucht das Prozessende (Worktree-Sperre) und
// verweigert das Löschen eines Worktrees mit nicht committeter Arbeit — diese Weigerung wird durchgereicht.
if (a.remove) {
  const id = String(a.remove);
  const e = (agents() || []).find((x) => x.id === id);
  if (!e) out({ ok: false, error: `Sitzung ${id} unbekannt` }, 4);
  spawnSync('claude', ['stop', id], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  for (let i = 0; i < 60 && alive(e.pid); i++) sleep(500);
  const r = spawnSync('claude', ['rm', id], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const msg = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const removed = /^removed\b/m.test(msg);
  out({ ok: removed, id, removed, fensterGeschlossen: removed ? fensterSchliessen(id) : 0, message: msg.slice(0, 600) }, removed ? 0 : 5);
}

if (a.logs) {
  const n = Number(a.lines) > 0 ? Number(a.lines) : 40;
  const r = spawnSync('claude', ['logs', String(a.logs)], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const lines = strip(`${r.stdout || ''}${r.stderr || ''}`).split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l && !/^[\s─━▔▁╌·-]+$/.test(l));
  process.stdout.write(lines.slice(-n).join('\n') + '\n');
  process.exit(r.status === 0 ? 0 : 1);
}

if (a.wait) {
  const id = String(a.wait);
  const timeout = (Number(a.timeout) > 0 ? Number(a.timeout) : 14400) * 1000;
  const interval = (Number(a.interval) > 0 ? Number(a.interval) : 15) * 1000;
  const t0 = Date.now();
  let seen = false;
  let last = null;
  for (;;) {
    const list = agents();
    if (list) {
      const e = list.find((x) => x.id === id) || null;
      if (e) { seen = true; last = e; }
      if (!seen && Date.now() - t0 > 30000) out({ ok: false, error: `Sitzung ${id} unbekannt` }, 4);
      const age = e && e.startedAt ? Date.now() - e.startedAt : Infinity;
      if (seen && finished(e) && age > GRACE_MS) out(e ? details(e) : { ok: true, id, state: 'gone', note: 'Sitzung nicht mehr gelistet' });
    }
    if (Date.now() - t0 > timeout) out({ ...(last ? details(last) : { id }), timeout: true }, 3);
    sleep(interval);
  }
}

const list = agents();
if (!list) out({ ok: false, error: 'Sitzungsliste nicht lesbar (claude agents --json)' }, 2);

if (a.id) {
  const e = list.find((x) => x.id === String(a.id));
  if (!e) out({ ok: false, error: `Sitzung ${a.id} unbekannt` }, 4);
  out(details(e));
}

out({
  ok: true,
  sessions: list.filter((e) => e.kind === 'background').map((e) => ({
    id: e.id, name: e.name || null, status: e.status || null, state: e.state || null, waitingFor: e.waitingFor || null, cwd: e.cwd || null,
  })),
});
