#!/usr/bin/env node
// einrichten.mjs — richtet das claude-starterpack in ~/.claude ein (oder in $CLAUDE_CONFIG_DIR).
// Ausgabe: genau eine JSON-Zeile auf stdout. Ändert nichts ohne Sicherung; --rueckgaengig nimmt alles zurück.
//
//   node einrichten.mjs --pruefen
//   node einrichten.mjs --name "<Name>" [--claude-md ersetzen|behalten] [--ohne-hook] [--uebung <ordner>] [--dry-run]
//   node einrichten.mjs --rueckgaengig <sicherungsordner>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..'); // .claude/skills/einrichtung/scripts → Repo
const TARGET = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const HOOK_MARK = 'project-memory-landkarte.js';

// Was installiert wird: Quelle im Repo → Ziel relativ zu TARGET.
const SOURCES = [
  { from: path.join(REPO, 'home'), to: '' },
  { from: path.join(REPO, 'kurs', 'einfuehrung'), to: path.join('skills', 'einfuehrung') },
];

function out(obj, code = 0) { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); }
function fail(error, extra = {}) { out({ ok: false, error, ...extra }, 2); }
const slash = (p) => p.split(path.sep).join('/');

function parseArgs(argv) {
  const flags = new Set(['--pruefen', '--dry-run', '--ohne-hook', '--help']);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) fail(`Unerwartetes Argument: ${k}`);
    if (flags.has(k)) { a[k.slice(2)] = true; continue; }
    if (i + 1 >= argv.length) fail(`${k} braucht einen Wert`);
    a[k.slice(2)] = argv[++i];
  }
  return a;
}

function walk(dir, base = dir) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p, base));
    else if (e.isFile()) files.push(path.relative(base, p));
  }
  return files;
}

// Alle Dateien des Pakets als { rel (Ziel relativ zu TARGET), src }.
// home/CLAUDE.md.vorlage heißt im Repo bewusst nicht CLAUDE.md: Claude Code würde sie sonst beim Lesen in home/
// als Anweisung laden. Installiert wird sie als CLAUDE.md.
function packageFiles() {
  const list = [];
  for (const s of SOURCES) {
    if (!fs.existsSync(s.from)) fail(`Quelle fehlt im Repo: ${s.from}`);
    for (const rel of walk(s.from)) {
      const to = rel === 'CLAUDE.md.vorlage' ? 'CLAUDE.md' : rel;
      list.push({ rel: path.join(s.to, to), src: path.join(s.from, rel) });
    }
  }
  return list;
}

function hookCommand() {
  return `node "${slash(path.join(TARGET, 'skills', 'project-memory', 'scripts', HOOK_MARK))}"`;
}

function readSettings(p) {
  if (!fs.existsSync(p)) return { exists: false, data: {} };
  const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) return { exists: true, data: {} };
  try { return { exists: true, data: JSON.parse(raw) }; } catch (e) { return { exists: true, error: e.message }; }
}

function hasHook(settings) {
  const ss = settings && settings.hooks && settings.hooks.SessionStart;
  if (!Array.isArray(ss)) return false;
  return ss.some((g) => Array.isArray(g && g.hooks) && g.hooks.some((h) => String(h && h.command || '').includes(HOOK_MARK)));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
  return { ok: !r.error && r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), error: r.error && r.error.code };
}

// ---------- --pruefen ----------
function pruefen() {
  const checks = [];
  const add = (name, ok, detail, hinweis) => checks.push({ name, ok, detail, ...(hinweis ? { hinweis } : {}) });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 18, process.version, major >= 18 ? null : 'Node.js 18 oder neuer installieren: https://nodejs.org');

  const git = run('git', ['--version']);
  add('git', git.ok, git.ok ? git.out : 'nicht gefunden', git.ok ? null : 'git installieren: https://git-scm.com');

  // Ohne Shell, genau wie spawn-worker claude aufruft: so fällt ein .cmd-Starter (npm) auf, den spawn.mjs nicht starten kann.
  const cv = run('claude', ['--version']);
  add('claude', cv.ok, cv.ok ? cv.out : (cv.error || 'nicht gefunden'), cv.ok ? null
    : 'Claude Code mit dem nativen Installer einrichten (https://docs.claude.com/en/docs/claude-code). Eine npm-Installation (.cmd) kann spawn-worker nicht starten.');
  if (cv.ok) {
    const help = run('claude', ['--help']);
    const bg = /--bg\b/.test(help.out);
    add('claude --bg', bg, bg ? 'Hintergrund-Sitzungen verfügbar' : 'fehlt', bg ? null : 'Claude Code aktualisieren (`claude update`); spawn-worker braucht `claude --bg`.');
  }

  const files = packageFiles();
  const missing = [], differs = [];
  for (const f of files) {
    const dst = path.join(TARGET, f.rel);
    if (f.rel === 'CLAUDE.md') continue;
    if (!fs.existsSync(dst)) missing.push(slash(f.rel));
    else if (!fs.readFileSync(dst).equals(fs.readFileSync(f.src))) differs.push(slash(f.rel));
  }
  add('dateien', missing.length === 0, missing.length ? `fehlen: ${missing.join(', ')}` : `${files.length - 1} Dateien da`
    + (differs.length ? `, abweichend: ${differs.join(', ')}` : ''), missing.length ? '/einrichtung ausführen' : null);

  const cmd = path.join(TARGET, 'CLAUDE.md');
  if (!fs.existsSync(cmd)) add('CLAUDE.md', false, 'fehlt', '/einrichtung ausführen');
  else {
    const t = fs.readFileSync(cmd, 'utf8');
    const ph = t.includes('<DEIN NAME>');
    const ours = t.includes('# Global-Kern');
    add('CLAUDE.md', ours && !ph, ph ? 'Platzhalter <DEIN NAME> noch drin' : ours ? 'eingerichtet' : 'eigene CLAUDE.md ohne Starterpack-Kern',
      ph ? 'Namen eintragen' : ours ? null : 'zusammenführen (siehe ~/.claude/CLAUDE.md.starterpack, falls vorhanden)');
  }

  const st = readSettings(path.join(TARGET, 'settings.json'));
  if (st.error) add('start-hook', false, `settings.json ist kein gültiges JSON (${st.error})`, 'settings.json reparieren, dann /einrichtung');
  else add('start-hook', hasHook(st.data), hasHook(st.data) ? 'eingetragen' : 'nicht eingetragen',
    hasHook(st.data) ? null : 'optional: /einrichtung trägt ihn ein; ohne Hook lädt /project-memory weiter die Landkarte von Hand');

  const lk = path.join(TARGET, 'skills', 'project-memory', 'scripts', HOOK_MARK);
  if (fs.existsSync(lk)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starterpack-probe-'));
    const r = run(process.execPath, [lk, '--landkarte', tmp], { cwd: tmp });
    fs.rmSync(tmp, { recursive: true, force: true });
    add('landkarte-skript', r.ok, r.ok ? 'läuft' : r.out.slice(0, 200));
  }

  const ok = checks.every((c) => c.ok || c.name === 'start-hook');
  out({ ok, ziel: TARGET, checks });
}

// ---------- Einrichten ----------
function stampNow() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function uebungAnlegen(dir, name, dry) {
  const abs = path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (fs.existsSync(path.join(abs, '.git'))) return { ordner: abs, status: 'vorhanden' };
  if (fs.existsSync(abs) && fs.readdirSync(abs).length) return { ordner: abs, status: 'ordner-nicht-leer', hinweis: 'anderen Ordner wählen' };
  if (dry) return { ordner: abs, status: 'wuerde-anlegen' };
  fs.mkdirSync(abs, { recursive: true });
  const g = (args) => run('git', args, { cwd: abs });
  g(['init', '-q']);
  const hatIdentitaet = run('git', ['config', 'user.name'], { cwd: abs }).out && run('git', ['config', 'user.email'], { cwd: abs }).out;
  let identitaet = 'global';
  if (!hatIdentitaet) { // nur für diesen Übungsordner, damit Worker und Übergabe committen können
    g(['config', 'user.name', name]); g(['config', 'user.email', 'uebung@localhost']); identitaet = 'nur-im-uebungsordner';
  }
  fs.writeFileSync(path.join(abs, 'README.md'), '# Übungsprojekt\n\nSpielwiese für die Einführung ins claude-starterpack.\n');
  g(['add', 'README.md']);
  const c = g(['commit', '-q', '-m', 'Übungsprojekt angelegt']);
  return { ordner: abs, status: c.ok ? 'angelegt' : 'angelegt-ohne-commit', identitaet, ...(c.ok ? {} : { fehler: c.out.slice(0, 200) }) };
}

function einrichten(a) {
  const name = String(a.name || '').trim();
  if (!name) fail('--name fehlt: Wie soll Claude dich nennen?');
  const mode = a['claude-md'] || 'behalten';
  if (!['ersetzen', 'behalten'].includes(mode)) fail('--claude-md ist ersetzen oder behalten');
  const dry = !!a['dry-run'];
  const stamp = stampNow();
  const backupDir = path.join(TARGET, `starterpack-sicherung-${stamp}`);
  const manifest = { stamp, ziel: TARGET, neu: [], ersetzt: [] };
  const plan = { neu: [], ersetzt: [], unveraendert: [], claudeMd: null, hook: null };

  const st = readSettings(path.join(TARGET, 'settings.json'));
  if (st.error && !a['ohne-hook']) fail(`settings.json ist kein gültiges JSON (${st.error}); nichts geändert`, { datei: path.join(TARGET, 'settings.json') });

  const backup = (rel) => {
    const to = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(TARGET, rel), to);
  };
  const write = (rel, buf) => {
    const to = path.join(TARGET, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buf);
  };

  for (const f of packageFiles()) {
    let buf = fs.readFileSync(f.src);
    let rel = f.rel;
    const dst = path.join(TARGET, rel);
    if (rel === 'CLAUDE.md') {
      buf = Buffer.from(buf.toString('utf8').split('<DEIN NAME>').join(name), 'utf8');
      if (fs.existsSync(dst) && !fs.readFileSync(dst).equals(buf) && mode === 'behalten') {
        rel = 'CLAUDE.md.starterpack'; // Endung bewusst nicht .md: Claude Code lädt die Datei so nicht
        plan.claudeMd = 'vorhanden-neue-fassung-daneben';
      } else plan.claudeMd = fs.existsSync(dst) ? (fs.readFileSync(dst).equals(buf) ? 'unveraendert' : 'ersetzt') : 'neu';
    }
    const to = path.join(TARGET, rel);
    if (fs.existsSync(to)) {
      if (fs.readFileSync(to).equals(buf)) { plan.unveraendert.push(slash(rel)); continue; }
      plan.ersetzt.push(slash(rel));
      if (!dry) { backup(rel); write(rel, buf); manifest.ersetzt.push(rel); }
    } else {
      plan.neu.push(slash(rel));
      if (!dry) { write(rel, buf); manifest.neu.push(rel); }
    }
  }

  if (a['ohne-hook']) plan.hook = 'ausgelassen';
  else if (hasHook(st.data)) plan.hook = 'vorhanden';
  else {
    plan.hook = st.exists ? 'eingetragen' : 'eingetragen-neue-settings';
    if (!dry) {
      const data = st.data;
      data.hooks = data.hooks || {};
      data.hooks.SessionStart = Array.isArray(data.hooks.SessionStart) ? data.hooks.SessionStart : [];
      data.hooks.SessionStart.push({
        matcher: 'startup|resume|clear|compact',
        hooks: [{ type: 'command', command: hookCommand(), timeout: 15, statusMessage: 'Projekt-Landkarte laden...' }],
      });
      if (st.exists) { backup('settings.json'); manifest.ersetzt.push('settings.json'); } else manifest.neu.push('settings.json');
      write('settings.json', Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8'));
    }
  }

  let uebung = null;
  if (a.uebung) uebung = uebungAnlegen(a.uebung, name, dry);

  const changed = manifest.neu.length + manifest.ersetzt.length > 0;
  if (!dry && changed) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  out({
    ok: true, dryRun: dry, ziel: TARGET, plan, uebung,
    sicherung: !dry && changed ? backupDir : null,
    rueckgaengig: !dry && changed ? `node "${slash(path.join(HERE, 'einrichten.mjs'))}" --rueckgaengig "${slash(backupDir)}"` : null,
    neustart: !dry && changed,
  });
}

// ---------- --rueckgaengig ----------
function rueckgaengig(dir) {
  const backupDir = path.resolve(dir);
  const mf = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(mf)) fail(`Kein manifest.json in ${backupDir}`);
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const target = path.resolve(m.ziel);
  const inside = (p) => !path.relative(target, p).startsWith('..') && !path.isAbsolute(path.relative(target, p));
  const entfernt = [], wiederhergestellt = [];
  for (const rel of m.ersetzt) {
    const to = path.join(target, rel);
    if (!inside(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(backupDir, rel), to);
    wiederhergestellt.push(slash(rel));
  }
  const dirs = new Set();
  for (const rel of m.neu) {
    const to = path.join(target, rel);
    if (!inside(to) || !fs.existsSync(to)) continue;
    fs.rmSync(to, { force: true });
    entfernt.push(slash(rel));
    for (let d = path.dirname(to); inside(d) && d !== target; d = path.dirname(d)) dirs.add(d);
  }
  // Leer gewordene Ordner entfernen, tiefste zuerst; Ordner mit fremden Dateien bleiben.
  for (const d of [...dirs].sort((x, y) => y.length - x.length)) {
    try { if (fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* bleibt */ }
  }
  out({ ok: true, ziel: target, wiederhergestellt, entfernt, sicherung: backupDir, hinweis: 'Sicherungsordner bleibt stehen; Claude Code neu starten.' });
}

const a = parseArgs(process.argv.slice(2));
if (a.help) { process.stdout.write('node einrichten.mjs --pruefen | --name "<Name>" [--claude-md ersetzen|behalten] [--ohne-hook] [--uebung <ordner>] [--dry-run] | --rueckgaengig <ordner>\n'); process.exit(0); }
if (a.pruefen) pruefen();
else if (a.rueckgaengig) rueckgaengig(a.rueckgaengig);
else einrichten(a);
