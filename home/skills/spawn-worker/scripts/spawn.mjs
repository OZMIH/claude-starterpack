#!/usr/bin/env node
// spawn-worker/spawn.mjs — startet eine Claude-Code-Hintergrund-Sitzung (`claude --bg`) verlässlich.
// Keine Shell dazwischen: die Argumente gehen als Array an claude.exe, der Prompt kommt byte-genau an.
// Ausgabe: genau eine JSON-Zeile auf stdout — {"ok":true,...} oder {"ok":false,"error":...} (Exit 2).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const MODES = ['auto', 'acceptEdits', 'plan', 'manual', 'dontAsk', 'bypassPermissions'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(os.tmpdir(), 'spawn-worker');

const HELP = `node spawn.mjs --dir <ordner> --name <name> (--prompt <text> | --prompt-file <datei>)
  [--role worker|planner] [--mode ${MODES.join('|')}] [--model <alias|id>]
  [--effort ${EFFORTS.join('|')}] [--worktree <name>] [--watch] [--dry-run] [--auto-compact] [--merge-main]`;

function out(obj, code = 0) { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); }
function fail(error, extra = {}) { out({ ok: false, error, ...extra }, 2); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } }

function parseArgs(argv) {
  const flags = new Set(['--watch', '--dry-run', '--help', '--auto-compact', '--merge-main']);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) fail(`Unerwartetes Argument: ${k}`);
    if (flags.has(k)) { a[k.slice(2)] = true; continue; }
    if (i + 1 >= argv.length) fail(`Wert fehlt für ${k}`);
    a[k.slice(2)] = argv[++i];
  }
  return a;
}

function gitRoot(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? path.resolve(r.stdout.trim()) : null;
}

function agents(all) {
  const r = spawnSync('claude', ['agents', '--json', ...(all ? ['--all'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

// Projekt-MCP-Server (.mcp.json vom Zielordner bis zur Laufwerkswurzel) gegen die gespeicherten
// Entscheidungen spiegeln. Unentschiedene Server werden abgeschaltet — sonst hängt der Worker an der
// Freigabe-Frage „New MCP server found in this project". Bereits Freigegebenes bleibt freigegeben.
function mcpDecision(dir) {
  const names = new Set();
  for (let d = dir; ; ) {
    const j = readJson(path.join(d, '.mcp.json'));
    if (j && j.mcpServers) Object.keys(j.mcpServers).forEach((n) => names.add(n));
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  const roots = [dir];
  const g = gitRoot(dir);
  if (g && g.toLowerCase() !== dir.toLowerCase()) roots.push(g);
  const files = roots.flatMap((r) => [path.join(r, '.claude', 'settings.local.json'), path.join(r, '.claude', 'settings.json')]);
  files.push(path.join(os.homedir(), '.claude', 'settings.json'));
  const en = new Set(); const dis = new Set(); let all = false;
  for (const f of files) {
    const j = readJson(f);
    if (!j) continue;
    (j.enabledMcpjsonServers || []).forEach((n) => en.add(n));
    (j.disabledMcpjsonServers || []).forEach((n) => dis.add(n));
    if (j.enableAllProjectMcpServers === true) all = true;
  }
  const undecided = all ? [] : [...names].filter((n) => !en.has(n) && !dis.has(n)).sort();
  return { names: [...names].sort(), enabled: [...en].sort(), disabled: [...new Set([...dis, ...undecided])].sort(), enableAll: all, undecided };
}

function pruneOld() {
  try {
    for (const f of fs.readdirSync(TMP)) {
      const p = path.join(TMP, f);
      if (f.endsWith('.settings.json') && Date.now() - fs.statSync(p).mtimeMs > 7 * 86400000) fs.unlinkSync(p);
    }
  } catch { /* Aufräumen ist Komfort */ }
}

const a = parseArgs(process.argv.slice(2));
if (a.help) { process.stdout.write(HELP + '\n'); process.exit(0); }

if (!a.dir) fail('--dir fehlt');
const dir = path.resolve(a.dir);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`Ordner existiert nicht: ${dir}`);
if (!a.name || !SAFE.test(a.name)) fail('--name fehlt oder ungültig (erlaubt: A-Z a-z 0-9 . _ -, höchstens 40 Zeichen)');
if ((a.prompt === undefined) === (a['prompt-file'] === undefined)) fail('Genau eins von --prompt oder --prompt-file angeben');
let prompt;
if (a.prompt !== undefined) prompt = a.prompt;
else { try { prompt = fs.readFileSync(path.resolve(a['prompt-file']), 'utf8'); } catch { fail(`Prompt-Datei nicht lesbar: ${a['prompt-file']}`); } }
prompt = prompt.replace(/^﻿/, '').replace(/\s+$/, '');
if (!prompt) fail('Prompt ist leer');
if (prompt.startsWith('-')) fail('Prompt darf nicht mit "-" beginnen (würde als Option gelesen)');

const role = a.role || 'worker';
if (!['worker', 'planner'].includes(role)) fail('--role muss worker oder planner sein');
const mode = a.mode || (role === 'planner' ? 'plan' : 'auto');
if (!MODES.includes(mode)) fail(`--mode muss eins von ${MODES.join(', ')} sein`);
if (role === 'planner' && mode !== 'plan') fail('Ein Planer läuft immer im Modus plan');
if (a.model !== undefined && !/^[A-Za-z0-9._[\]-]+$/.test(a.model)) fail('--model ungültig');
if (mode === 'auto' && a.model && /haiku/i.test(a.model)) fail('Auto-Modus greift mit Haiku nicht (belegt 2026-09-24): sonnet, opus oder fable nehmen, oder --mode acceptEdits');
if (a.effort !== undefined && !EFFORTS.includes(a.effort)) fail(`--effort muss eins von ${EFFORTS.join(', ')} sein`);
// Pflichtangaben: Ohne --model erbte der Worker still das Dialog-Modell, also das teuerste.
if (!a.model) fail('--model fehlt: opus oder fable aus der Kopfzeile des Goals');
if (!a.effort) fail('--effort fehlt: Worker-Goals laufen mit high, xhigh nur bei benannter Fehlerklasse');
if (a.worktree !== undefined) {
  if (!SAFE.test(a.worktree)) fail('--worktree-Name ungültig');
  if (!gitRoot(dir)) fail('--worktree braucht ein Git-Repo');
}


const active = agents(false);
if (active === null) fail('Sitzungsliste nicht lesbar (claude agents --json)');
if (active.some((e) => e.name === a.name)) fail(`Es läuft bereits eine Sitzung namens ${a.name}`);

// Merge-Freigabe: eigener Schalter --merge-main; --auto-compact schließt sie als Altpfad weiter ein (Langläufer mergen main).
const mergeMain = a['merge-main'] ? 'merge-main' : a['auto-compact'] ? 'auto-compact (Altpfad)' : null;

const mcp = mcpDecision(dir);
let settingsFile = null;
fs.mkdirSync(TMP, { recursive: true });
pruneOld();
if (mcp.names.length || a['auto-compact'] || mergeMain) {
  const s = {};
  if (mcp.names.length) {
    s.enabledMcpjsonServers = mcp.enabled; s.disabledMcpjsonServers = mcp.disabled;
    if (mcp.enableAll) s.enableAllProjectMcpServers = true;
  }
  // Auto-Compact nur für diesen Worker, das globale autoCompactEnabled bleibt unberührt
  if (a['auto-compact']) s.autoCompactEnabled = true;
  // --merge-main: feste Erlaubnis, den Hauptstand main in die eigene Arbeitskopie zusammenzuführen
  if (mergeMain) s.permissions = { allow: ['Bash(git merge main)', 'Bash(git merge --no-edit main)', 'Bash(git merge main *)', 'Bash(git merge --no-edit main *)'] };
  settingsFile = path.join(TMP, `${a.name}-${Date.now()}.settings.json`);
  fs.writeFileSync(settingsFile, JSON.stringify(s));
}

const args = ['--bg', '--name', a.name, '--permission-mode', mode];
if (a.model) args.push('--model', a.model);
if (a.effort) args.push('--effort', a.effort);
if (a.worktree !== undefined) args.push('--worktree', a.worktree);
if (settingsFile) args.push('--settings', settingsFile);
args.push(prompt);

if (a['dry-run']) out({ ok: true, dryRun: true, cwd: dir, args, mcp, effort: a.effort || '(Standard)', autoCompact: !!a['auto-compact'], mergeMain, settingsFile });

const r = spawnSync('claude', args, { cwd: dir, encoding: 'utf8', timeout: 90000, windowsHide: true });
// Aus einer Hintergrundsitzung trägt die Ausgabe von `claude --bg` Farbcodes; ohne Entfernen scheitert der Abgleich,
// obwohl die Kind-Sitzung läuft, und ein zweiter Start wäre ein Doppelstart.
const text = `${r.stdout || ''}${r.stderr || ''}`.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
const m = text.match(/backgrounded\s+·\s+([0-9a-f]{6,})\s+·/);
if (!m) fail('Start fehlgeschlagen', { output: text.trim().slice(0, 800), exitCode: r.status });
const id = m[1];

let entry = null;
for (let i = 0; i < 20 && !entry; i++) { entry = (agents(true) || []).find((e) => e.id === id) || null; if (!entry) sleep(500); }

if (a.watch) {
  // Ein abgekoppelter Hilfsprozess wird mit dem Ende des aufrufenden Tool-Befehls beendet, bevor er
  // ein Fenster öffnet (belegt 2026-09-24). Synchron per Start-Process öffnet es zuverlässig im Vordergrund.
  const title = `${a.name} ${id}`.replace(/'/g, '');
  const inner = `$Host.UI.RawUI.WindowTitle=''${title}''; claude attach ${id}`;
  spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Start-Process powershell.exe -WorkingDirectory '${dir.replace(/'/g, "''")}' -ArgumentList '-NoExit','-Command','${inner}'`],
    { windowsHide: true, encoding: 'utf8' });
}

const status = path.join(HERE, 'status.mjs');
out({
  ok: true, id, sessionId: entry ? entry.sessionId : null, name: a.name, role, mode,
  model: a.model || '(Standard der CLI)', effort: a.effort || '(Standard)', cwd: entry ? entry.cwd : dir,
  worktree: a.worktree || null, mcpOff: mcp.disabled.filter((n) => mcp.names.includes(n)), mcpUndecidedSetOff: mcp.undecided,
  watch: !!a.watch, registered: !!entry, autoCompact: !!a['auto-compact'],
  next: {
    wait: `node "${status}" --wait ${id}`, status: `node "${status}" --id ${id}`, logs: `node "${status}" --logs ${id} --lines 30`,
    send: `node "${status}" --send ${id} --message "<antwort>"`, remove: `node "${status}" --remove ${id}`, attach: `claude attach ${id}`,
  },
});
