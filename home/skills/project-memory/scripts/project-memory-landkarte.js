#!/usr/bin/env node
// SessionStart-Hook (matcher: startup|resume|clear|compact) — Stufe-1-Landkarte des Projekt-Memorys injizieren.
// Ersetzt den Lade-Teil von `/project-memory weiter`: Landkarte kommt ohne Befehl, Themen weiter per Befehl.
//
// Budget: Claude Code lagert additionalContext ab ~10.000 Bytes als Datei aus und gibt dem Modell nur
// einen Pfad + 2-KB-Vorschau (gemessen 2026-09-09: 9.499 Zeichen inline, 9.999 persistiert). Deshalb
// harter Deckel 9.400 Bytes; OVERVIEW steht zuletzt, damit der Schnitt den Wegweiser trifft, nicht den
// Arbeitspunkt.
//
// v2.4 (2026-09-24, Memory-Fix):
// - Worktrees: memory/ liegt im Repo, also hat jeder Worktree eine eigene Kopie. Geladen wird die Kopie mit
//   der jüngsten Übergabe (v2.5: SESSION-Datei bzw. DETAILVIEW-Commit, siehe cmpHandoff; Worker-Appends und
//   ungesicherte Notizen zählen nicht). Ist der eigene Worktree älter oder ohne memory/, steht oben ein Hinweis.
//   Dieselbe Übergabe → eigener Worktree.
// - Auto-Memory: Claude Code löst ~/.claude/projects/<schlüssel>/memory über den Haupt-Worktree auf (beobachtet
//   an Claude Code 2.1.281). Sicherheitsnetz für den Rückfall
//   auf den Worktree-Schlüssel: Junction projects/<worktree>/memory → projects/<haupt>/memory, nur wenn der
//   Worktree-Ordner fehlt oder leer ist; sonst nur eine Warnung.
// - „Seit letzter Übergabe" (Commits auf allen lokalen Branches) und „Läuft gerade" (~/.claude/jobs).
// - Git-Aufrufe laufen je Stufe parallel (sonst ~75 ms je Aufruf nacheinander beim Sessionstart).
// - CLI: `node project-memory-landkarte.js --sammeln [dir]` = Übergabe-Rohstoff seit der letzten Übergabe
//   (für `/project-memory übergabe`), `--landkarte [dir]` = Landkarte als Klartext (Test).
//
// v2.5 (2026-09-24, Verify-Befunde):
// git nur mit --no-optional-locks (fremde Worktrees nie beschreiben) · Auswahl nach jüngster Übergabe ·
// kaputte jobs/*/state.json überspringen · git-Zeitlimits und Notbremse sichtbar · Kopf in Stufen.
//
// v2.6 (2026-10-30):
// - Ablageort: optionale .project-memory.json {"path": "docs/memory"} im Projekt-Root (Sitzungsordner, sonst
//   Worktree-Wurzel). Gilt für Landkarte, --sammeln und alle git-Pfade; ohne Datei ./memory/ wie bisher.
// - „Läuft gerade" zusätzlich aus memory/RUNNING.md (pidfile:/process:), alle Prüfungen zusammen ≤ 2 s.
// - „Offen bei dir: n" aus der NEXT-STEPS-Tabelle mit Spalte Zuständig (alte Listen bleiben gültig).
// - CLI `--geheimnisse [dir]` (Lint-Check 11) und `--init-pruefen [dir]` (Ablageort, Entscheidungsdatei,
//   AGENTS.md für init). .obsidian/ wird bei --sammeln und Lint übergangen.
//
// v2.7 (2026-10-30):
// - Projekt- und personenneutral: Persönliches (Owner-Name, Integrationen) steht in der Nutzer-Config
//   ($PROJECT_MEMORY_CONFIG, sonst $XDG_CONFIG_HOME bzw. ~/.config/project-memory/config.json), nie im Skill.
// - Auch bei `compact` registriert: nach dem Verdichten kommt die Landkarte des eigenen Projekts zurück.
// - CLI `--fremdtext [dir]` (Lint-Check 12: Rohtext und Anweisungs-Muster im Memory).
// v2.8 (2026-11-24): OFFENE-PUNKTE.md im Repo-Hauptordner ist die eine Liste offener Fragen und ausstehender
//   Entscheidungen (Global-Kern). Die Landkarte zeigt ihre offenen `- [ ]`-Einträge, --sammeln listet sie zum
//   Abgleich bei der Übergabe, --init-pruefen meldet, ob sie fehlt. Ohne die Datei bleibt alles wie in v2.7.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const BUDGET_BYTES = 9400;
const TRUNC_HINT = '\n\n[Landkarte über Budget (9.400 Bytes, Harness-Deckel ~10 KB) — OVERVIEW/DETAILVIEW straffen; Rest per /project-memory weiter]';
const WIN = process.platform === 'win32';
const SELF = __filename.split(path.sep).join('/'); // eigener Pfad für Nachlade-Hinweise (Installationsort kann abweichen)
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const MAX_OTHER_WORKTREES = 8; // mehr werden nicht verglichen (Sessionstart-Latenz)
const REPORT_RE = /(status|bericht|report|verif|signoff|journal|nachtlauf|handoff|protokoll|lessons|decisions|heartbeat|koordination|pruef|prüf|ergebnis|summary)/i;

// ---------- Helfer ----------

function read(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim(); } catch { return ''; }
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function norm(p) {
  const r = path.resolve(p);
  return WIN ? r.toLowerCase() : r;
}

function same(a, b) { return norm(a) === norm(b); }

function inside(child, parent) {
  const c = norm(child), p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim() === heading);
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n').trim();
}

// Git-Ausgabe roh (für -z) — nie werfen, bei Fehler/Timeout ''.
// --no-optional-locks + GIT_OPTIONAL_LOCKS=0: `git status` frischt sonst den Index auf und nimmt index.lock —
// auch in fremden Worktrees mit laufendem Worker (ein Worktree, ein Schreiber). Der Hook liest nur.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
// Abgebrochene Aufrufe (Zeitlimit, maxBuffer) liefern '' wie ein leeres Ergebnis. Damit das unter Last nicht
// still als echter Wert durchgeht, werden sie gezählt und in der Landkarte gekennzeichnet.
const gitHealth = { timeouts: 0, cwds: new Set() };
function gitRaw(cwd, args, timeout = 2000) {
  return new Promise(resolve => {
    try {
      execFile('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args],
        { cwd, env: GIT_ENV, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err && err.killed) { gitHealth.timeouts++; gitHealth.cwds.add(norm(cwd)); }
          resolve(err ? '' : stdout);
        });
    } catch { resolve(''); }
  });
}

function gitHealthWarning(compact = false) {
  if (!gitHealth.timeouts) return '';
  const reload = `Neu laden: \`node "${SELF}" --landkarte .\``;
  return compact
    ? `⚠ git-Stand unvollständig (${gitHealth.timeouts} git-Aufruf(e) über dem Zeitlimit). ${reload}`
    : `⚠ git-Stand unvollständig: ${gitHealth.timeouts} git-Aufruf(e) über dem Zeitlimit (Rechner ausgelastet?). Memory-Quelle, ` +
      `Warnungen, „Seit letzter Übergabe" und der git-Abschnitt können lückenhaft sein. ${reload}`;
}

async function git(cwd, args, maxLine, timeout) {
  const out = (await gitRaw(cwd, args, timeout)).trim();
  return maxLine ? out.split('\n').map(l => l.length > maxLine ? l.slice(0, maxLine) + '…' : l).join('\n') : out;
}

function clip(text, budget) {
  if (Buffer.byteLength(text, 'utf8') <= budget) return text;
  let cut = text;
  while (Buffer.byteLength(cut, 'utf8') > budget) cut = cut.slice(0, Math.floor(cut.length * 0.97));
  const nl = cut.lastIndexOf('\n');
  if (nl > budget / 2) cut = cut.slice(0, nl);
  return cut + TRUNC_HINT;
}

function isReport(f) {
  return /\.(md|txt|jsonl)$/i.test(f) && REPORT_RE.test(f);
}

function short(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `vor ${m} min`;
  if (m < 48 * 60) return `vor ${Math.round(m / 60)} h`;
  return `vor ${Math.round(m / 1440)} d`;
}

// ---------- Ablageort (v2.6) ----------

const CONFIG_FILE = '.project-memory.json';
const layoutWarnings = new Set(); // ungültige .project-memory.json → Warnung oben in der Landkarte

// Memory-Ordner für einen Projektordner: .project-memory.json in base, sonst in der Worktree-Wurzel top.
// path ist relativ zum Ordner der Datei und muss im Worktree bleiben (Repo-Isolation); sonst ./memory/ + Warnung.
// root = Bezugsordner für relative Pfade aus dem Memory (RUNNING.md-pidfiles).
function memLayout(base, top) {
  for (const root of top && !same(top, base) ? [base, top] : [base]) {
    const f = path.join(root, CONFIG_FILE);
    if (!exists(f)) continue;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) || {}; } catch { /* unten */ }
    const p = data.path;
    const dir = typeof p === 'string' && p.trim() ? path.resolve(root, p.trim()) : '';
    if (dir && inside(dir, top || root)) return { root, dir, cfg: f, data };
    layoutWarnings.add(`⚠ ${f} ungültig (erwartet {"path": "<ordner im Repo>"}) — genutzt wird ./memory/.`);
    break;
  }
  return { root: base, dir: path.join(base, 'memory'), cfg: '' };
}

// ---------- Nutzer-Config (v2.7) ----------

// Alles Persönliche lebt außerhalb des Skills. Felder (alle optional): owner, owner_aliases, job_status_command,
// knowledge_base, after_handoff, claude_md_append (Bedeutung: Referenz „Nutzer-Config").
const USER_CONFIG_FILE = process.env.PROJECT_MEMORY_CONFIG ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'project-memory', 'config.json');
let userCfgCache;
function userConfig() {
  if (userCfgCache) return userCfgCache;
  userCfgCache = {};
  if (!exists(USER_CONFIG_FILE)) return userCfgCache;
  try {
    const c = JSON.parse(fs.readFileSync(USER_CONFIG_FILE, 'utf8').replace(/^﻿/, ''));
    if (c && typeof c === 'object' && !Array.isArray(c)) userCfgCache = c;
    else throw new Error();
  } catch { layoutWarnings.add(`⚠ Nutzer-Config ${USER_CONFIG_FILE} ist kein gültiges JSON-Objekt — ignoriert.`); }
  return userCfgCache;
}

// Owner = wer bei „Zuständig" als „du" zählt. .project-memory.json des Repos überschreibt die Nutzer-Config.
function ownerInfo(repoCfg) {
  const u = userConfig(), r = repoCfg || {};
  const name = String(r.owner || u.owner || 'Owner');
  // Setzt das Repo einen eigenen Owner, gelten nur dessen Aliasse (die der Nutzer-Config gehören zu einer anderen Person).
  const aliases = [].concat((r.owner ? r.owner_aliases : u.owner_aliases) || []).map(String);
  const esc = s => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = [name, ...aliases, 'owner'].filter(s => s.trim()).map(esc);
  return { name, re: new RegExp(`^(${words.join('|')})(?=$|[\\s,;/()])`, 'i') };
}

// Pfad relativ zur Worktree-Wurzel als git-Pfadangabe (Aufruf mit cwd = Worktree-Wurzel).
function gitPath(wtPath, p) {
  return path.relative(wtPath, p).split(path.sep).join('/') || '.';
}

function underDir(file, relDir) {
  return relDir !== '.' && (file === relDir || file.startsWith(relDir + '/'));
}

const OBSIDIAN_RE = /(^|\/)\.obsidian(\/|$)/;

// Erste Markdown-Tabelle, deren Kopfzeile headRe trifft: { cols: [kleingeschrieben], rows: [[zellen]] }.
function parseTable(text, headRe) {
  const lines = text.split('\n');
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/^`|`$/g, ''));
  const h = lines.findIndex(l => /^\s*\|/.test(l) && headRe.test(l));
  if (h === -1) return null;
  const rows = [];
  for (const l of lines.slice(h + 1)) {
    if (!/^\s*\|/.test(l)) break;
    if (/^\s*\|[\s:|-]+\|?\s*$/.test(l)) continue; // Trennzeile
    rows.push(cells(l));
  }
  return { cols: cells(lines[h]).map(c => c.toLowerCase()), rows };
}

// v2.6: offene Punkte mit Zuständigkeit. null = keine Tabelle mit Spalte Zuständig (alte Liste, nichts anzeigen).
// v2.7: „du" = Owner aus Nutzer-/Repo-Config (Name, Aliasse) oder das Wort „Owner".
function openForOwner(s) {
  const t = parseTable(section(read(path.join(s.dir, 'NEXT-STEPS.md')), '## Open'), /zust(ä|ae)ndig/i);
  if (!t) return null;
  const i = t.cols.findIndex(c => /zust(ä|ae)ndig/.test(c));
  return t.rows.filter(r => s.owner.re.test(r[i] || '')).length;
}

// ---------- Eigene Dauerprozesse (memory/RUNNING.md, v2.6) ----------

const PROC_TIMEOUT = 1500; // Prozessliste; pidfile-Prüfungen sind synchron und sofort → zusammen < 2 s

// v2.8: OFFENE-PUNKTE.md — gesucht in der Worktree-Wurzel der Memory-Quelle, dann im eigenen, dann im Haupt-Worktree.
// Offen = Zeilen „- [ ]“ (auch eingerückt). checkbox=false: Datei ohne Checklisten-Format (etwa Tabellen) → nur Hinweis.
const OP_FILE = 'OFFENE-PUNKTE.md';
function openPoints(roots) {
  for (const r of roots.filter(Boolean)) {
    const file = path.join(r, OP_FILE);
    if (!exists(file)) continue;
    const lines = read(file).split('\n');
    const open = lines.filter(l => /^\s*[-*] \[ \]/.test(l)).map(l => l.trim().replace(/^[-*] \[ \]\s*/, ''));
    return { file, open, checkbox: lines.some(l => /^\s*[-*] \[[ xX>-]\]/.test(l)) };
  }
  return null;
}

function openPointsBlock(op, max, width) {
  if (!op) return '';
  if (!op.checkbox) return `### ${OP_FILE} (kein \`- [ ]\`-Format erkannt — Datei lesen: ${op.file})`;
  const items = op.open.slice(0, max).map(t => `- [ ] ${short(t, width)}`);
  if (op.open.length > max) items.push(`- (+${op.open.length - max} weitere in ${OP_FILE})`);
  return [`### ${OP_FILE} (${op.open.length} offen)`, ...(items.length ? items : ['(nichts offen)'])].join('\n');
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const procName = n => String(n).trim().toLowerCase().replace(/\.exe$/, '');

// Namen aller laufenden Prozesse (klein, ohne .exe), null wenn nicht ermittelbar.
function processNames() {
  if (!WIN && exists('/proc/self/comm')) {
    const names = new Set();
    try {
      for (const id of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(id)) continue;
        try { names.add(procName(fs.readFileSync(`/proc/${id}/comm`, 'utf8'))); } catch { continue; }
        try { names.add(procName(path.basename(fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').split('\0')[0]))); } catch { /* weg */ }
      }
    } catch { return Promise.resolve(null); }
    return Promise.resolve(names);
  }
  const [cmd, args] = WIN ? ['tasklist', ['/FO', 'CSV', '/NH']] : ['ps', ['-A', '-o', 'comm=']];
  return new Promise(resolve => {
    try {
      execFile(cmd, args, { encoding: 'utf8', timeout: PROC_TIMEOUT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve(null);
        const names = new Set();
        for (const l of out.split(/\r?\n/)) {
          const n = WIN ? (l.match(/^"([^"]*)"/) || [])[1] : path.basename(l.trim());
          if (n) names.add(procName(n));
        }
        resolve(names);
      });
    } catch { resolve(null); }
  });
}

// [{ name, ok: true|false|null, text }] je Zeile der RUNNING.md-Tabelle; [] ohne Datei.
async function runningProcs(s) {
  const t = parseTable(read(path.join(s.dir, 'RUNNING.md')), /pr(ü|ue)fung|check/i);
  if (!t) return [];
  const col = re => t.cols.findIndex(c => re.test(c));
  const [iName, iCheck, iStart] = [col(/^name/), col(/pr(ü|ue)fung|check/), col(/start/)];
  const rows = t.rows.map(r => ({ name: r[iName] || '?', check: r[iCheck] || '', start: (iStart >= 0 && r[iStart]) || '—' }))
    .filter(r => r.check);
  const names = rows.some(r => /^process:/i.test(r.check)) ? await processNames() : null;
  return rows.map(r => {
    const m = r.check.match(/^(pidfile|process):\s*(.+)$/i);
    let ok = null, info = '';
    if (m && m[1].toLowerCase() === 'pidfile') {
      const pid = parseInt(read(path.resolve(s.root, m[2])), 10);
      ok = pid > 0 && pidAlive(pid);
      if (ok) info = ` (PID ${pid})`;
    } else if (m) {
      ok = names ? names.has(procName(m[2])) : null;
    }
    const state = ok ? `läuft${info}` : ok === false ? `GESTOPPT → Start: ${r.start}`
      : m ? 'unbekannt (Prozessliste nicht lesbar)' : `unbekannt (Prüfung „${short(r.check, 30)}" nicht pidfile:/process:)`;
    return { name: r.name, ok, text: `- ${short(r.name, 40)}: ${state}` };
  });
}

function procsShort(procs) {
  if (!procs.length) return '';
  const stopped = procs.filter(p => p.ok === false), up = procs.filter(p => p.ok).length;
  return `Dauerprozesse (RUNNING.md): ${up} läuft/laufen` +
    (stopped.length ? `, ${stopped.length} GESTOPPT (${stopped.map(p => p.text.replace(/^- /, '')).join('; ')})` : '') +
    (procs.length - up - stopped.length ? `, ${procs.length - up - stopped.length} unbekannt` : '');
}

function projectName(dir, fallback) {
  const m = read(path.join(dir, 'VISION.md')).match(/^#\s*VISION\s*[—–-]+\s*(.+?)\s*(?:\(.*\))?\s*$/m);
  return m ? m[1].trim() : fallback;
}

// ---------- Worktrees und Memory-Stand ----------

function parseWorktrees(porcelain) {
  const list = [];
  let cur = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) list.push(cur = { path: path.resolve(line.slice(9).trim()), head: '', branch: '', bare: false, prunable: false });
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    else if (line.trim() === 'detached') cur.branch = 'detached';
    else if (line.trim() === 'bare') cur.bare = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  return list;
}

// Git-Kontext der Sitzung: eigener Worktree (top), Pfad darunter (rel), alle Worktrees, Haupt-Worktree.
async function repoInfo(cwd) {
  const [topRaw, porcelain] = await Promise.all([
    git(cwd, ['rev-parse', '--show-toplevel']),
    gitRaw(cwd, ['worktree', 'list', '--porcelain']),
  ]);
  if (!topRaw) return null;
  const top = path.resolve(topRaw);
  const rel = path.relative(top, cwd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const wts = parseWorktrees(porcelain);
  const main = wts[0] && !wts[0].bare ? wts[0].path : null;
  const own = wts.find(w => same(w.path, top)) || { path: top, head: '', branch: '' };
  return { top, rel, wts, main, own };
}

function lastSession(dir) {
  let best = null;
  try {
    for (const f of fs.readdirSync(path.join(dir, 'sessions'))) {
      const m = f.match(/^SESSION-(\d+)(?:-(\d{4}-\d{2}-\d{2}))?/);
      if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), id: `SESSION-${m[1]}`, date: m[2] || '', file: f };
    }
  } catch { /* keine sessions/ */ }
  return best;
}

function parseStatusZ(raw) {
  const files = [];
  const parts = raw.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    files.push({ code: code.trim() || code, file: parts[i].slice(3) });
    if (code[0] === 'R' || code[0] === 'C') i++; // Umbenennung: nächster Eintrag ist der alte Pfad
  }
  return files;
}

function parseCommit(line) {
  if (!line) return null;
  const [ct, sha, date, full, iso, at] = line.split('\t');
  // ats = Autorzeit: bleibt bei cherry-pick/rebase erhalten, anders als die Committer-Zeit (ts).
  return sha ? { ts: (Number(ct) || 0) * 1000, sha, date, full, iso, ats: (Number(at) || Number(ct) || 0) * 1000 } : null;
}

function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

// Stand einer memory/-Kopie. withGit=false → nur Dateisystem (kein Repo).
// handoff = Commit, der die jüngste SESSION-Datei angelegt hat; ohne SESSION-Commit: letzter Commit auf
// DETAILVIEW (v1: CURRENT-STATE), sonst letzter memory-Commit.
// mark = die jüngste echte Übergabe, nach der die Kopien geordnet werden: SESSION-Nummer,
// Datei und Zeitpunkt. Worker-Appends (LEARNED, topics-Log, note) und ungesicherte Notizen zählen nicht.
// ownHead (nur für fremde Worktrees): zählt memory-Commits dort, die im eigenen Branch fehlen
// (--cherry-pick ignoriert inhaltsgleich übernommene Commits).
// v2.6: dir aus .project-memory.json, sonst <sitzungsordner>/memory; s.rel = dir relativ zur Worktree-Wurzel
// (git-Pfadangabe), die git-Aufrufe laufen deshalb in der Worktree-Wurzel.
async function memState(wt, rel, withGit, ownHead) {
  const base = path.join(wt.path, rel);
  const lay = memLayout(base, withGit ? wt.path : null);
  const dir = lay.dir;
  const v2 = exists(path.join(dir, 'VISION.md'));
  if (!v2 && !exists(path.join(dir, 'CURRENT-STATE.md'))) return null;
  const session = lastSession(dir);
  const markFile = session ? path.join(dir, 'sessions', session.file) : path.join(dir, v2 ? 'DETAILVIEW.md' : 'CURRENT-STATE.md');
  const mrel = gitPath(wt.path, dir);
  const s = { wt, base, root: lay.root, dir, rel: mrel, owner: ownerInfo(lay.data), v2, session, commitTs: 0, sha: '', date: '', dirty: 0, dirtyTs: 0, handoff: null, missing: 0,
    mark: { n: session ? session.n : -1, file: markFile, ts: 0, open: false } };
  if (withGit) {
    const fmt = '--format=%ct%x09%h%x09%cs%x09%H%x09%cI%x09%at';
    const diverge = ownHead && wt.head && ownHead !== wt.head;
    const top = wt.path;
    const [log, st, added, markLog, missing] = await Promise.all([
      git(top, ['log', '-1', fmt, '--', mrel]),
      gitRaw(top, ['status', '--porcelain', '-z', '--untracked-files=all', '--', mrel]),
      git(top, ['log', '-1', '--diff-filter=A', fmt, '--', gitPath(top, path.join(dir, 'sessions'))]),
      session ? '' : git(top, ['log', '-1', fmt, '--', gitPath(top, markFile)]),
      diverge ? git(top, ['rev-list', '--count', '--right-only', '--cherry-pick', `${ownHead}...${wt.head}`, '--', mrel]) : '',
    ]);
    s.missing = Number(missing) || 0;
    const last = parseCommit(log);
    if (last) { s.commitTs = last.ts; s.sha = last.sha; s.date = last.date; }
    const addedC = parseCommit(added), markC = parseCommit(markLog);
    s.handoff = addedC || markC || last;
    // Pfade in git status --porcelain sind relativ zur Repo-Wurzel.
    const sesRel = session ? path.relative(wt.path, markFile).split(path.sep).join('/') : '';
    for (const f of parseStatusZ(st)) {
      s.dirty++;
      s.dirtyTs = Math.max(s.dirtyTs, mtime(path.join(wt.path, f.file)));
      if (sesRel && f.file === sesRel && (f.code === '??' || f.code[0] === 'A')) s.mark.open = true;
    }
    if (session) s.mark.ts = s.mark.open ? mtime(markFile) : (addedC ? addedC.ats : 0);
    else s.mark.ts = markC ? markC.ats : 0;
    s.gitGaps = gitHealth.cwds.has(norm(base));
  } else {
    s.mark.ts = mtime(markFile);
  }
  s.fresh = Math.max(s.commitTs, s.dirtyTs);
  return s;
}

// Ordnung zweier memory/-Kopien nach ihrer jüngsten Übergabe (>0: a neuer). Höhere SESSION-Nummer gewinnt;
// gleiche Nummer mit gleichem Inhalt = dieselbe Übergabe (auch nach cherry-pick) → 0; sonst die spätere.
function cmpHandoff(a, b) {
  if (a.mark.n !== b.mark.n) return a.mark.n - b.mark.n;
  if (read(a.mark.file) === read(b.mark.file)) return 0;
  return a.mark.ts - b.mark.ts;
}

// Welche memory/-Kopie wird geladen? Die mit der jüngsten Übergabe; bei derselben Übergabe der eigene
// Worktree (Nachträge anderer Worktrees meldet die DIVERGENZ-Warnung). Nur zwischen fremden Kopien mit
// derselben Übergabe entscheidet der jüngste Stand (fresh).
function ownState(cwd, info) {
  return info ? memState(info.own, info.rel, true) : memState({ path: cwd, head: '', branch: '' }, '', false);
}

async function resolveMemory(cwd, info, ownPromise) {
  const ownWt = info ? info.own : { path: cwd, head: '', branch: '' };
  const rel = info ? info.rel : '';
  const others = info
    ? info.wts.filter(w => !w.bare && !w.prunable && !same(w.path, ownWt.path) && exists(w.path))
    : [];
  const limited = others.length > MAX_OTHER_WORKTREES;
  const [own, ...rest] = await Promise.all([ownPromise || ownState(cwd, info),
    ...others.slice(0, MAX_OTHER_WORKTREES).map(w => memState(w, rel, true, info.own.head))]);
  const all = [own, ...rest].filter(Boolean);
  let src = own;
  for (const s of all) {
    if (s === own) continue;
    const d = src ? cmpHandoff(s, src) : 1;
    if (d > 0 || (d === 0 && src !== own && s.fresh > src.fresh)) src = s;
  }
  return { own, src, all, limited };
}

function label(s) {
  if (!s) return 'kein memory/';
  const parts = [s.session ? `${s.session.id}${s.session.date ? ` (${s.session.date})` : ''}` : 'keine SESSION-Datei'];
  if (s.sha) parts.push(`memory-Commit ${s.sha} ${s.date}`);
  if (s.dirty) parts.push(`${s.dirty} ungesicherte memory-Änderung(en)${s.mark.open ? ', SESSION-Datei nicht committet' : ''}`);
  if (s.gitGaps) parts.push('git-Stand unvollständig');
  return parts.join(' · ');
}

// compact = Kurzform für den gekürzten Kopf: gleiche Aussage, ohne Befehls- und Commit-Details.
function staleWarning(r, info, compact = false) {
  const { own, src } = r;
  const lines = [];
  const where = s => `${s.wt.path}${s.wt.branch ? ` (Branch ${s.wt.branch})` : ''}`;
  const sid = s => (s.session ? s.session.id : 'keine SESSION-Datei');
  const ob = info ? info.own.branch || 'HEAD' : 'HEAD';
  const cmp = s => (s.wt.branch ? ` Welche: \`git log --cherry-pick --right-only ${ob}...${s.wt.branch} -- ${same(s.base, s.wt.path) ? '' : ':/'}${s.rel}\`.` : '');
  const miss = s => (s.missing ? ` (${s.missing} memory-Commit(s) fehlen hier)` : '');
  if (src && !own) {
    lines.push(compact ? `⚠ MEMORY-STAND: hier kein memory/, geladen aus ${where(src)} (${sid(src)}).`
      : `⚠ MEMORY-STAND: Dieser Worktree hat kein memory/. Geladen wurde ${where(src)} · ${label(src)}.`);
  } else if (src && src !== own && compact) {
    lines.push(`⚠ MEMORY-STAND VERALTET: hier ${sid(own)}, geladen die neuere Übergabe aus ${where(src)} (${sid(src)}${src.mark.open ? ', nicht committet' : ''}). ` +
      'Vor `übergabe` übernehmen (cherry-pick oder merge).');
  } else if (src && src !== own) {
    const take = src.mark.open ? 'Die Übergabe dort ist noch nicht committet: nach ihrem Commit übernehmen (cherry-pick oder merge), vorher hier keine übergabe.'
      : `Vor \`/project-memory übergabe\` die memory-Commits von dort übernehmen (cherry-pick oder merge), sonst entsteht eine Parallelkette.${cmp(src)}`;
    lines.push(`⚠ MEMORY-STAND VERALTET: Dieser Worktree hat eine ältere Übergabe (${label(own)}). Geladen wurde die neuere aus ${where(src)} · ${label(src)}${miss(src)}. ${take}`);
  }
  // Divergenz: andere Worktrees mit memory-Commits, die hier fehlen, obwohl sie nicht geladen wurden.
  if (own) {
    for (const s of r.all) {
      if (s === own || s === src || !s.missing) continue;
      const kind = src && cmpHandoff(s, src) <= 0 ? ' (Nachträge, keine neuere Übergabe)' : '';
      lines.push(`⚠ MEMORY-DIVERGENZ: ${where(s)} hat ${s.missing} memory-Commit(s)${kind}, die hier fehlen — vor \`übergabe\` zusammenführen.${compact ? '' : cmp(s)}`);
    }
  }
  return lines.join('\n');
}

async function commitsSince(top, handoff, limit) {
  if (!handoff || !handoff.iso) return [];
  const out = await git(top, ['log', '--branches', `--since=${handoff.iso}`, '-n', String(limit), '--source', '--no-merges',
    '--format=%ct%x09%h%x09%cs%x09%S%x09%s'], 0, 5000);
  const rows = [];
  for (const l of out.split('\n')) {
    const [ct, sha, date, ref, ...subj] = l.split('\t');
    if (!sha || (Number(ct) || 0) * 1000 <= handoff.ts) continue;
    rows.push({ ts: Number(ct) * 1000, sha, date, ref: (ref || '').replace(/^refs\/heads\//, ''), subject: subj.join('\t') });
  }
  return rows.sort((a, b) => b.ts - a.ts);
}

// { full, short, n } für den Kopf der Landkarte (short = gekürzter Kopf), null ohne Übergabe/git.
async function sinceLine(info, src, preRows) {
  if (!info || !src || !src.handoff) return null;
  const h = src.handoff;
  const rows = preRows || await commitsSince(info.top, h, 500);
  const pre = `Seit letzter Übergabe (${src.session ? src.session.id + ', ' : ''}${h.date}): `;
  if (!rows.length) return { full: pre + 'keine neuen Commits.', short: pre + 'keine neuen Commits.', n: '0' };
  const n = `${rows.length}${rows.length >= 500 ? '+' : ''}`;
  const branches = new Set(rows.map(r => r.ref)).size;
  const top = rows[0];
  let full = `${pre}${n} Commit(s) auf ${branches} Branch(es) · jüngster: ${top.sha} ${top.date} [${top.ref}] ${short(top.subject, 90)}`;
  if (rows.length >= 10) full += '\n→ Memory hinkt hinterher: `/project-memory übergabe` sammelt das automatisch ein.';
  return { full, short: `${pre}${n} Commit(s)${rows.length >= 10 ? ' → `/project-memory übergabe` fällig' : ''}`, n };
}

// Hintergrund-Sitzungen (claude --bg) in einem Worktree dieses Repos. Best effort: internes Format.
// maxAgeDays begrenzt auch working/blocked (verwaiste Sitzungen); idle/done nur 48 h.
function runningJobs(info, cwd, max, maxAgeDays) {
  const roots = info ? info.wts.map(w => w.path) : [cwd];
  const dir = path.join(CONFIG_DIR, 'jobs');
  const rows = [];
  let ids = [];
  try { ids = fs.readdirSync(dir); } catch { return rows; }
  for (const id of ids) {
    // Ein kaputter Eintrag darf nur sich selbst kosten, nie die Landkarte.
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, id, 'state.json'), 'utf8'));
      if (!s || typeof s !== 'object' || typeof s.cwd !== 'string' || !s.cwd || !roots.some(r => inside(s.cwd, r))) continue;
      const ts = Date.parse(String(s.updatedAt || s.createdAt || '')) || 0;
      const age = Date.now() - ts;
      const live = s.state === 'working' || s.state === 'blocked';
      if (live ? age > maxAgeDays * 86400e3 : age > 48 * 3600e3) continue;
      const wt = info ? info.wts.find(w => inside(s.cwd, w.path)) : null;
      const place = wt && info && !same(wt.path, info.top) ? path.basename(path.dirname(wt.path)) + '/' + path.basename(wt.path) : 'hier';
      const what = s.state === 'blocked' && s.needs ? `braucht: ${s.needs}` : (s.detail || '');
      rows.push({ ts, name: String(s.name || id), text: `- ${s.name || id} (${id}) · ${s.state || '?'} · ${place} · ${short(what, 110)} · ${ts ? ago(ts) : '?'}` });
    } catch { /* unlesbar oder fremdes Format: überspringen */ }
  }
  return rows.sort((a, b) => b.ts - a.ts).slice(0, max);
}

// ---------- Auto-Memory über Worktrees (Junction) ----------

// Schlüssel wie Claude Code: jedes Nicht-Alphanumerische → '-'. Über 200 Zeichen hängt Claude Code einen
// Hash an — nicht nachbauen, dann wird nichts verknüpft.
function projectKey(p) {
  const k = path.resolve(p).normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-');
  return k.length <= 200 ? k : null;
}

function autoMemoryLink(info) {
  if (!info || !info.main || same(info.main, info.top)) return '';
  const kWt = projectKey(info.top), kMain = projectKey(info.main);
  if (!kWt || !kMain || kWt.toLowerCase() === kMain.toLowerCase()) return '';
  const projects = path.join(CONFIG_DIR, 'projects');
  const link = path.join(projects, kWt, 'memory');
  const target = path.join(projects, kMain, 'memory');
  if (!exists(target)) return ''; // Haupt-Worktree hat noch keine Auto-Memory: nichts zu teilen
  let st = null;
  try { st = fs.lstatSync(link); } catch { /* fehlt */ }
  try {
    if (st && st.isSymbolicLink()) {
      return same(fs.realpathSync.native(link), fs.realpathSync.native(target)) ? ''
        : `⚠ Auto-Memory: ${link} zeigt nicht auf ${target} — Verknüpfung prüfen.`;
    }
    if (st && st.isDirectory()) {
      const n = fs.readdirSync(link).length;
      if (n > 0) {
        return `⚠ Auto-Memory getrennt: ${link} hat ${n} eigene Einträge, geteilt wäre ${target}. ` +
          'Nicht automatisch verknüpft — Inhalte zusammenführen, Ordner leeren, der Hook verknüpft beim nächsten Start.';
      }
      fs.rmdirSync(link);
    } else if (st) {
      return `⚠ Auto-Memory: ${link} ist weder Ordner noch Verknüpfung — prüfen.`;
    }
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'junction');
    return `Auto-Memory-Verknüpfung angelegt: ${link} → ${target}`;
  } catch (e) {
    return `⚠ Auto-Memory-Verknüpfung fehlgeschlagen (${e.code || e.message}).`;
  }
}

// ---------- Landkarte ----------

async function build(cwd) {
  const [info, status, log5] = await Promise.all([
    repoInfo(cwd),
    git(cwd, ['status', '--short', '--branch']),
    git(cwd, ['log', '-5', '--oneline'], 120),
  ]);
  const linkNote = autoMemoryLink(info);
  // Commits seit der Übergabe spekulativ ab dem eigenen Stand zählen, parallel zum Worktree-Vergleich;
  // nur verworfen, wenn die geladene Kopie eine andere letzte Übergabe hat.
  const ownP = ownState(cwd, info);
  const specP = ownP.then(s => (info && s && s.handoff ? commitsSince(info.top, s.handoff, 500) : null));
  const r = await resolveMemory(cwd, info, ownP);
  const src = r.src;
  if (!src) {
    const note = [...layoutWarnings, linkNote].filter(Boolean).join('\n');
    return note ? `PROJEKT-HINWEIS (project-memory) — ${path.basename(cwd)}\n${note}` : null;
  }

  const sameHandoff = r.own && r.own.handoff && src.handoff && r.own.handoff.full === src.handoff.full;
  const procsP = runningProcs(src); // läuft parallel zu den git-Aufrufen von sinceLine
  const since = await sinceLine(info, src, sameHandoff ? await specP : null);
  const jobs = runningJobs(info, cwd, 20, 7);
  const procs = await procsP;
  const owner = src.v2 ? openForOwner(src) : null;
  const ownerLine = owner === null ? '' : `Offen bei dir: ${owner} (NEXT-STEPS ## Open, Zuständig ${src.owner.name})`;
  const op = src.v2 ? openPoints([src.wt.path, info ? info.top : cwd, info && info.main]) : null;
  const opBlock = openPointsBlock(op, 6, 140);
  const opCount = op && op.checkbox ? `Offene Punkte: ${op.open.length}` : '';
  const budget = BUDGET_BYTES - Buffer.byteLength(TRUNC_HINT, 'utf8');
  const multi = r.all.length > 1;

  let body;
  if (src.v2) {
    body = [
      '', '### VISION.md', read(path.join(src.dir, 'VISION.md')),
      '', '### INDEX.md', read(path.join(src.dir, 'INDEX.md')),
      '', '### DETAILVIEW.md', read(path.join(src.dir, 'DETAILVIEW.md')),
      ...(opBlock ? ['', opBlock] : []), // v2.8: vor NEXT-STEPS, damit die eine Liste bei Kürzung nicht zuerst fällt
      '', '### NEXT-STEPS.md (nur Open)', section(read(path.join(src.dir, 'NEXT-STEPS.md')), '## Open') || '(kein ## Open-Abschnitt)',
      '', '### FORBIDDEN.md', read(path.join(src.dir, 'FORBIDDEN.md')),
      '', `### git${multi ? ' (dieser Worktree)' : ''}`, status || '(kein git)', log5,
      '', '### OVERVIEW.md', read(path.join(src.dir, 'OVERVIEW.md')),
    ].join('\n');
  } else {
    const v1 = read(path.join(src.dir, 'CURRENT-STATE.md'));
    if (!v1) return linkNote || null;
    body = ['', v1, '', 'Für v2-Features: /project-memory migrate. Übergabe: /project-memory übergabe.'].join('\n');
  }

  // Kopf in vier Stufen: Der Kopf darf den Inhalt nicht verdrängen. Gewählt wird die erste Stufe,
  // mit der alles ins Budget passt. Warnungen bleiben in jeder Stufe (ab Stufe 2 kurz). Stufe 3 ist so klein
  // wie der Kopf vor v2.4; passt selbst sie nicht, schneidet clip() wie damals am Ende von OVERVIEW.
  // Warnungen erst nach allen git-Aufrufen, damit die Timeout-Kennzeichnung vollständig ist.
  const layoutWarn = [...layoutWarnings].join('\n');
  const warnFull = [layoutWarn, staleWarning(r, info), gitHealthWarning()].filter(Boolean).join('\n');
  const warnShort = [layoutWarn, staleWarning(r, info, true), gitHealthWarning(true)].filter(Boolean).join('\n');
  const title = src.v2 ? `PROJEKT-LANDKARTE (project-memory, Stufe 1) — ${projectName(src.dir, path.basename(cwd))}`
    : `PROJEKT-LANDKARTE (project-memory v1) — ${path.basename(cwd)}`;
  const wtCount = multi ? ` · Worktrees mit memory/: ${r.all.length}${src === r.own ? ' (dieser ist aktuell)' : ''}` : '';
  const quelle = `Quelle: ${src.dir} · ${label(src)}${wtCount}${r.limited ? ` · nur ${MAX_OTHER_WORKTREES} weitere Worktrees verglichen` : ''}${opCount ? ` · ${opCount}` : ''}`;
  const quelleMin = [`Quelle: ${src === r.own ? 'memory/ dieses Worktrees' : src.dir}`, src.session ? src.session.id : 'keine SESSION-Datei',
    since ? `${since.n} Commit(s) seit Übergabe` : '', jobs.length ? `${jobs.length} Hintergrund-Sitzung(en)` : '',
    procs.some(p => p.ok === false) ? `GESTOPPT: ${procs.filter(p => p.ok === false).map(p => short(p.name, 20)).join(', ')} (Start: RUNNING.md)` : '',
    owner ? `Offen bei dir: ${owner}` : '', opCount,
    src.gitGaps ? 'git-Stand unvollständig' : ''].filter(Boolean).join(' · ');
  const hint = src.v2 ? 'Handoff, nicht Wahrheit (bei Widerspruch gewinnt git). „weiter"/„wo waren wir" → zuerst Wiedereinstieg laut `/project-memory weiter`; ' +
    'Thema `weiter <slug>` (INDEX Regal 2); Ende `übergabe`.' : '';
  const hintShort = src.v2 ? 'Handoff, nicht Wahrheit (git gewinnt). Wiedereinstieg und Themen: `/project-memory weiter [slug]`; Ende `übergabe`.' : '';
  const alert = linkNote.startsWith('⚠') ? linkNote : '';
  const jobList = n => jobs.slice(0, n).map(j => j.text).concat(jobs.length > n ? [`- (+${jobs.length - n} weitere)`] : []);
  const procList = procs.length ? 'Läuft gerade (eigene Dauerprozesse, RUNNING.md):\n' + procs.map(p => p.text).join('\n') : '';
  const live = (sinceText, jl) => {
    const l = [sinceText, procList, jl.length ? 'Läuft gerade (Hintergrund-Sitzungen):\n' + jl.join('\n') : '', ownerLine].filter(Boolean);
    return l.length ? '\n### Seit letzter Übergabe / läuft gerade\n' + l.join('\n') : '';
  };
  const jobsShort = jobs.length ? `Läuft gerade: ${jobs.length} Hintergrund-Sitzung(en) (${jobs.slice(0, 4).map(j => short(j.name, 30)).join(', ')}${jobs.length > 4 ? ', …' : ''})` : '';
  const warnBlock = w => (w ? w + '\n' : '');
  const heads = [
    [warnBlock(warnFull), title, quelle, linkNote, hint, live(since && since.full, jobList(4))],
    [warnBlock(warnFull), title, quelle, linkNote, hint, live(since && since.short, jobList(2))],
    [warnBlock(warnShort), title, quelle, alert, hintShort, since && since.short, procsShort(procs), jobsShort, ownerLine],
    [warnBlock(warnShort), title, quelleMin, alert, hintShort],
  ].map(h => h.filter(Boolean).join('\n'));
  for (const h of heads) {
    const text = h + '\n' + body;
    if (Buffer.byteLength(text, 'utf8') <= budget) return text;
  }
  return clip(heads[heads.length - 1] + '\n' + body, budget);
}

// ---------- Übergabe-Rohstoff (--sammeln) ----------

function stackCheck(dir) {
  const rows = [];
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'topics')).filter(f => f.endsWith('.md')); } catch { return rows; }
  for (const f of files) {
    const text = read(path.join(dir, 'topics', f));
    const h2 = text.split('\n').map((l, i) => ({ l, i })).filter(x => /^## /.test(x.l));
    const status = h2.filter(x => /status/i.test(x.l));
    const extra = h2.filter(x => !/^## (Status|Log|Offen)\s*$/.test(x.l.trim()) && !/status/i.test(x.l));
    const logSec = section(text, '## Log');
    const logEntries = logSec ? logSec.split('\n').filter(l => /^\s*- /.test(l)).length : 0;
    const kb = Math.round(Buffer.byteLength(text, 'utf8') / 1024);
    const finds = [];
    if (status.length > 1) finds.push(`${status.length} Status-Abschnitte (${status.map(x => `Z. ${x.i + 1} „${short(x.l, 40)}"`).join(', ')}) → nur \`## Status\` bleibt, der Rest wörtlich nach topics/archive/${f}`);
    if (kb > 20) finds.push(`${kb} KB, ${logEntries} Log-Einträge → ältere Log-Einträge (vor den letzten drei Sessions) nach topics/archive/${f} verschieben`);
    if (extra.length) finds.push(`Zusatz-Abschnitte: ${extra.map(x => `„${short(x.l, 40)}"`).join(', ')} (prüfen: Wissen oder Verlauf?)`);
    if (finds.length) rows.push(`- topics/${f}: ${finds.join(' · ')}`);
  }
  return rows;
}

async function sammeln(cwd) {
  const info = await repoInfo(cwd);
  const r = await resolveMemory(cwd, info);
  const src = r.src;
  const ownDir = memLayout(cwd, info ? info.top : null).dir;
  if (!src) return `[project-memory] Kein Memory in ${ownDir}${info ? ' oder einem anderen Worktree dieses Repos' : ''}. /project-memory init zum Anlegen.` +
    [...layoutWarnings].map(w => `\n${w}`).join('');
  const out = [`# Übergabe-Rohstoff — ${projectName(src.dir, path.basename(cwd))}`,
    'Read-only gesammelt von project-memory-landkarte.js --sammeln. Grundlage für die Vorschläge der übergabe; Belege gegen git prüfen.', ''];

  out.push('## Memory-Quelle');
  const warn = staleWarning(r, info);
  if (warn) for (const l of warn.split('\n')) out.push(`- ${l}`);
  // Geschrieben wird nur im eigenen Worktree (ein Worktree, ein Schreiber), nie in die memory/-Kopie eines anderen.
  for (const w of layoutWarnings) out.push(`- ${w}`);
  out.push(`- Schreibziel (dieser Worktree): ${r.own ? `${r.own.dir} · ${label(r.own)}` : `${ownDir} fehlt — erst den Stand aus dem neuesten Worktree übernehmen`}`);
  const h = src.handoff;
  const maxN = Math.max(0, ...r.all.map(s => (s.session ? s.session.n : 0)));
  const next = `SESSION-${String(maxN + 1).padStart(3, '0')}`;
  out.push(`- Letzte Übergabe: ${h ? `${src.session ? src.session.id + ' · ' : ''}Commit ${h.sha} ${h.iso}` : 'nicht im git gefunden'} · nächste Nummer (über alle Worktrees): ${next}`);
  if (r.all.length > 1) for (const s of r.all) out.push(`- Worktree ${s.wt.path}${s.wt.branch ? ` [${s.wt.branch}]` : ''}: ${label(s)}${s === src ? ' ← neuester' : ''}`);
  out.push('');

  if (info && h) {
    const [rows, names, appends] = await Promise.all([
      commitsSince(info.top, h, 1000),
      git(info.top, ['log', '--branches', `--since=${h.iso}`, '-n', '1000', '--no-merges', '--name-only', '--format=%x01%ct'], 0, 5000),
      git(src.wt.path, ['diff', '--stat=120', `${h.full}..HEAD`, '--', src.rel], 0, 5000),
    ]);
    out.push(`## Commits seit der letzten Übergabe (alle lokalen Branches, neueste zuerst) — ${rows.length}`);
    for (const c of rows.slice(0, 40)) out.push(`- ${c.sha} ${c.date} [${c.ref}] ${short(c.subject, 140)}`);
    if (rows.length > 40) out.push(`- (+${rows.length - 40} weitere: git log --branches --since=${h.iso} --oneline)`);
    out.push('');

    const counts = new Map();
    let ok = true;
    for (const l of names.split('\n')) {
      if (l.startsWith('\x01')) { ok = (Number(l.slice(1)) || 0) * 1000 > h.ts; continue; }
      const f = l.trim();
      if (!ok || !f || !/\.(md|txt|jsonl)$/i.test(f) || /(^|\/)memory\//.test(f) || underDir(f, src.rel) || OBSIDIAN_RE.test(f)) continue;
      counts.set(f, (counts.get(f) || 0) + 1);
    }
    const docs = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.push(`## Dokumente mit Änderungen seit der Übergabe (★ = Bericht/Verify/Journal/Status; Top 20 von ${docs.length})`);
    for (const [f, n] of docs.slice(0, 20)) out.push(`- ${isReport(f) ? '★ ' : ''}${f} (${n}×)`);
    out.push('');

    out.push('## memory/ seit der Übergabe (Worker-Appends: LEARNED, topics-Log/Offen, NEXT-STEPS)');
    out.push(appends ? appends.split('\n').map(l => `    ${l.trim()}`).join('\n') : '- keine');
    out.push('');
  } else if (!info) {
    out.push('## git', '- kein Git-Repo: Commits und Dokumente nicht sammelbar', '');
  }

  if (info) {
    out.push('## Ungesichert in den Worktrees (git status, max 15 je Worktree)');
    const wts = info.wts.filter(w => !w.bare && !w.prunable && exists(w.path));
    const states = await Promise.all(wts.map(w => gitRaw(w.path, ['status', '--porcelain', '-z'], 5000)));
    let any = false;
    wts.forEach((w, i) => {
      const st = parseStatusZ(states[i]).filter(f => !OBSIDIAN_RE.test(f.file));
      if (!st.length) return;
      any = true;
      out.push(`- ${w.path}${w.branch ? ` [${w.branch}]` : ''}: ${st.length} Einträge`);
      for (const f of st.slice(0, 15)) out.push(`    ${f.code} ${isReport(f.file) ? '★ ' : ''}${f.file}`);
    });
    if (!any) out.push('- alles committet');
    out.push('');
  }

  const jobs = runningJobs(info, cwd, 8, 3650).map(j => j.text);
  out.push('## Hintergrund-Sitzungen in diesem Repo (~/.claude/jobs)');
  out.push(...(jobs.length ? jobs : ['- keine']));
  const jobCmd = userConfig().job_status_command;
  if (jobs.length && jobCmd) out.push(`  Letzte Antwort je Sitzung: ${jobCmd}`);
  out.push('');

  const procs = await runningProcs(src);
  if (procs.length) out.push(`## Eigene Dauerprozesse (${path.join(src.dir, 'RUNNING.md')})`, ...procs.map(p => p.text), '');

  // Offen: alte Liste (- [ ]) und v2.6-Tabelle (Zeilen mit N-ID) zählen beide.
  const items = section(read(path.join(src.dir, 'NEXT-STEPS.md')), '## Open').split('\n')
    .filter(l => /^\s*- \[ \]/.test(l) || /^\s*\|\s*\**N-\d+/.test(l));
  const owner = openForOwner(src);
  out.push(`## Inbox (NEXT-STEPS ## Open) — ${items.length} offen${owner === null ? '' : `, davon bei ${src.owner.name}: ${owner}`}`);
  out.push(...items.slice(0, 12).map(l => short(l, 200)));
  out.push('');

  // v2.8: die eine Liste offener Fragen und Entscheidungen, zum Abgleich bei der Übergabe.
  const op = openPoints([src.wt.path, info ? info.top : cwd, info && info.main]);
  if (!op) out.push(`## ${OP_FILE} — fehlt (pro Projekt eine Liste: offene Fragen und Entscheidungen der Session dort als \`- [ ]\` anlegen)`);
  else if (!op.checkbox) out.push(`## ${OP_FILE} — ${op.file} (kein \`- [ ]\`-Format erkannt: Datei lesen und im Format der Datei abgleichen)`);
  else {
    out.push(`## ${OP_FILE} — ${op.open.length} offen (${op.file}) · abgleichen: \`- [x]\` nur mit belegter Antwort im Eintrag, neue Fragen/Entscheidungen als \`- [ ]\``);
    out.push(...op.open.slice(0, 20).map(t => `- [ ] ${short(t, 200)}`));
    if (op.open.length > 20) out.push(`- (+${op.open.length - 20} weitere)`);
  }
  out.push('');

  const stack = stackCheck(src.dir);
  out.push('## Stapel-Check (ersetzen statt stapeln)');
  out.push(...(stack.length ? stack : ['- sauber']));

  // v2.7: Commit-Sperre der übergabe. Läuft beim Verify (zweites --sammeln) automatisch mit.
  const lint = [...secretRows(src.dir).rows, ...foreignRows(src.dir).rows];
  out.push('', `## Vor dem Commit (Lint 11 Geheimnisse, 12 Fremdtext) — ${lint.length ? `${lint.length} Befund(e): erst klären, dann committen` : 'sauber'}`);
  out.push(...lint.map(l => `- ${l}`));

  // v2.7: persönliche Integrationen aus der Nutzer-Config (nie im Skill selbst).
  const u = userConfig();
  const repoRoot = info ? info.top : cwd;
  const hooks = [].concat(u.after_handoff || []).filter(h => h && h.run && (!h.when_exists || exists(path.join(repoRoot, h.when_exists))));
  if (u.knowledge_base || hooks.length) {
    out.push('', `## Integrationen (Nutzer-Config ${USER_CONFIG_FILE})`);
    if (u.knowledge_base) out.push(`- Wissensbasis (Wissen über das Projekt hinaus): ${u.knowledge_base}`);
    for (const h of hooks) {
      out.push(`- Nach dem Commit ausführen: \`${h.run}\`${h.stdin ? ` mit stdin \`${h.stdin}\`` : ''}`);
    }
    if (hooks.length) out.push('  Platzhalter: {SESSION} = SESSION-NNN, {DATE} = YYYY-MM-DD, {HANDOFF_FILE} = Pfad der SESSION-Datei relativ zum Repo.');
  }
  const gw = gitHealthWarning();
  if (gw) out.splice(2, 0, gw, '');
  return out.join('\n');
}

// ---------- Lint-Check 11: Geheimnisse (--geheimnisse, v2.6) ----------

// Nur Fundort und Art werden ausgegeben, nie der Wert. show = was vom Treffer sichtbar bleiben darf.
const SECRET_PATTERNS = [
  { art: 'privater Schlüssel', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g, show: m => m[0] },
  { art: 'GitHub-Token', re: /\b(gh[pousr]_)[A-Za-z0-9]{20,}|\b(github_pat_)[A-Za-z0-9_]{20,}/g },
  { art: 'API-Schlüssel (sk-)', re: /\b(sk-(?:ant-|proj-)?)[A-Za-z0-9_-]{16,}/g },
  { art: 'Stripe-Schlüssel', re: /\b([sr]k_(?:live|test)_)[A-Za-z0-9]{16,}/g },
  { art: 'AWS-Zugangsschlüssel', re: /\b(AKIA)[0-9A-Z]{16}\b/g },
  { art: 'Slack-Token', re: /\b(xox[abprs]-)[A-Za-z0-9-]{10,}/g },
  { art: 'Google-API-Schlüssel', re: /\b(AIza)[0-9A-Za-z_-]{35}/g },
  { art: 'Token (JWT)', re: /\b(eyJ)[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Zuweisungen: Passwörter ab 6 Zeichen mit Ziffer/Sonderzeichen oder ab 12; KEY/TOKEN/SECRET nur lange Zufallsketten.
  { art: 'Zuweisung', re: /\b([A-Za-z0-9_.-]*(?:PASSWORD|PASSWORT|PASSWD|PWD|KENNWORT|KEY|TOKEN|SECRET)[A-Za-z0-9_]*)\s*[:=]\s*["']?([^\s"'`<>]+)/gi,
    test: m => {
      const v = m[2];
      if (/^(\$|\{|%|\*|x{3,}|…|\.\.\.|your|example|changeme$|env:|process\.env)/i.test(v)) return false;
      if (/pass|pwd|kennwort/i.test(m[1])) return v.length >= 12 || (v.length >= 6 && /[\d\W_]/.test(v));
      return v.length >= 20 && /[A-Za-z]/.test(v) && /\d/.test(v) && entropy(v) >= 3.5;
    },
    show: m => `${m[1]}=` },
];

function entropy(s) {
  const n = new Map();
  for (const c of s) n.set(c, (n.get(c) || 0) + 1);
  let e = 0;
  for (const k of n.values()) e -= (k / s.length) * Math.log2(k / s.length);
  return e;
}

function scanSecrets(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const found = [];
    for (const p of SECRET_PATTERNS) {
      for (const m of line.matchAll(p.re)) {
        if (p.test && !p.test(m)) continue;
        const len = p.art === 'Zuweisung' ? m[2].length : m[0].length;
        const shown = p.show ? p.show(m) : (m[1] || m[2] || '');
        found.push({ start: m.index, end: m.index + m[0].length, art: p.art, red: `${shown}████ (${len} Zeichen, geschwärzt)` });
      }
    }
    // Überlappende Treffer (z. B. API_KEY=sk-…) zählen einmal: der früheste, bei Gleichstand der längste.
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    let end = -1, last = null;
    for (const f of found) {
      if (f.start >= end) { hits.push(last = { line: i + 1, art: f.art, red: f.red }); end = f.end; }
      else if (last.art === 'Zuweisung' && f.art !== 'Zuweisung') last.art = `${f.art} in Zuweisung`;
    }
  });
  return hits;
}

function walkFiles(dir, skip, max = 4000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < max) {
    const d = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.test(e.name)) stack.push(p); } else if (e.isFile()) out.push(p);
    }
  }
  return out.sort();
}

function memFiles(dir) {
  return walkFiles(dir, /^(\.obsidian|\.git|node_modules)$/)
    .filter(f => /\.(md|txt|json|jsonl|ya?ml|env|csv|log|ini|toml)$/i.test(f) && fs.statSync(f).size <= 2 * 1024 * 1024);
}

const relMem = (dir, f) => path.relative(dir, f).split(path.sep).join('/');

function secretRows(dir) {
  const files = exists(dir) ? memFiles(dir) : [];
  const rows = [];
  for (const f of files) {
    for (const h of scanSecrets(fs.readFileSync(f, 'utf8'))) {
      rows.push(`Geheimnisse: ${h.art} ${h.red} → Fix: Wert entfernen, nur den Fundort nennen (SETUP: „liegt in …"), Schlüssel rotieren ` +
        `(${relMem(dir, f)}:${h.line})`);
    }
  }
  return { files: files.length, rows };
}

// Lint-Check 12 (v2.7): Memory ist Daten, keine Anweisung. Rohtext von außen (Web-, Tool-, Crawler-Ausgaben) und
// Anweisungs-Muster gehören nicht ins Memory, weil jedes spätere Modell es als vertrauenswürdige Übergabe liest.
// Je Datei und Art nur der erste Fundort plus Anzahl, damit ein Dump die Ausgabe nicht flutet.
const FOREIGN_PATTERNS = [
  { art: 'Anweisungs-Muster', re: /\b(ignore (all )?(the )?(previous|prior|above) (instructions|prompts?)|disregard (all )?(previous|prior) (instructions|prompts?)|ignoriere (alle )?(vorherigen|bisherigen|obigen) (anweisungen|instruktionen))/i },
  { art: 'Tool-/Crawler-Rohausgabe', re: /("type":\s*"(input_text|tool_result|tool_use)"|\bciteturn\d|\bturn\d+(view|search|fetch)\d|<\/?(script|iframe)\b)/i },
  // Lange Prosa-Absätze sind normal; lange JSON-Zeilen sind fast immer kopierte Rohausgaben.
  { art: 'JSON-Rohzeile (> 2.000 Zeichen)', test: l => l.length > 2000 && /^\s*[[{]\s*["{[]/.test(l) },
];
const FOREIGN_NAME_RE = /(^|[-_.])(raw|dump|scrape[dr]?|crawl(ed)?)([-_.]|$)/i;

function foreignRows(dir) {
  const files = exists(dir) ? memFiles(dir) : [];
  const rows = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    if (FOREIGN_NAME_RE.test(path.basename(f, path.extname(f)))) {
      rows.push(`Fremdtext: Dateiname deutet auf Rohdaten → Fix: außerhalb des Memorys ablegen, im Memory nur Zusammenfassung + Verweis (${relMem(dir, f)}:1)`);
    }
    for (const p of FOREIGN_PATTERNS) {
      const hits = lines.map((l, i) => ((p.test ? p.test(l) : p.re.test(l)) ? i + 1 : 0)).filter(Boolean);
      if (hits.length) {
        rows.push(`Fremdtext: ${p.art} (${hits.length}×) → Fix: Rohtext außerhalb des Memorys ablegen (z. B. docs/research/), ` +
          `im Memory nur Zusammenfassung + Verweis (${relMem(dir, f)}:${hits[0]})`);
      }
    }
  }
  return { files: files.length, rows };
}

async function memLintCli(cwd, title, fn) {
  const info = await repoInfo(cwd);
  const dir = memLayout(cwd, info ? info.top : null).dir;
  if (!exists(dir)) return `[project-memory] Kein Memory in ${dir}.` + [...layoutWarnings].map(w => `\n${w}`).join('');
  const r = fn(dir);
  return [`[project-memory] ${title} — ${dir} — ${r.files} Datei(en), ${r.rows.length} Befund(e)`, ...layoutWarnings, ...r.rows].join('\n');
}

const geheimnisse = cwd => memLintCli(cwd, 'Lint-Check 11 Geheimnisse', secretRows);
const fremdtext = cwd => memLintCli(cwd, 'Lint-Check 12 Fremdtext', foreignRows);

// ---------- init-Vorprüfung (--init-pruefen, v2.6) ----------

// Repo-Entscheidungsdateien: DECISIONS.md oder CONTEXT.md mit D-IDs (D-001, D1, auch in Tabellen), Tiefe ≤ 3,
// außerhalb des Memory-Ordners. Liefert die Kandidaten für den DECISIONS-Verweis bei init.
function decisionSources(root, memDir) {
  const skip = /^(\.git|node_modules|\.obsidian|\.venv|venv|dist|build|archive|\.claude|\.next)$/;
  const rows = [];
  const visit = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3 && !skip.test(e.name) && !inside(p, memDir)) visit(p, depth + 1); continue; }
      if (!/^(DECISIONS|CONTEXT)\.md$/i.test(e.name)) continue;
      const ids = new Set();
      for (const m of read(p).matchAll(/^(?:#{1,6}\s*|\s*[-*]\s*\**|\|\s*\**)(D-?\d{1,4})\b/gm)) ids.add(m[1]);
      if (ids.size) rows.push({ file: p, n: ids.size, format: [...ids][0].includes('-') ? 'D-NNN' : 'DN' });
    }
  };
  visit(root, 0);
  return rows;
}

async function initPruefen(cwd) {
  const info = await repoInfo(cwd);
  const root = info ? info.top : cwd;
  const lay = memLayout(cwd, info ? info.top : null);
  const rel = f => path.relative(root, f).split(path.sep).join('/');
  const srcs = decisionSources(root, lay.dir);
  const marker = (f, m) => (exists(f) ? (read(f).includes(m) ? 'vorhanden, Block schon drin' : 'vorhanden, Block fehlt → anhängen') : 'fehlt → anlegen');
  return [
    `[project-memory] init-Vorprüfung — ${root}`,
    ...layoutWarnings,
    `- Repo: ${info ? `git, Worktree ${info.top}` : 'kein git'}`,
    `- Memory-Pfad: ${lay.dir} (${lay.cfg ? `aus ${rel(lay.cfg)}` : 'Default ./memory/'}) · ${exists(lay.dir) ? 'EXISTIERT → init bricht ab' : 'frei'}`,
    `- Entscheidungsdatei im Repo: ${srcs.length ? `${srcs.length} gefunden` : 'keine → DECISIONS.md normal anlegen'}`,
    ...srcs.map(s => `    ${rel(s.file)} · ${s.n} D-IDs · Format ${s.format}${srcs.length > 1 ? ' (mehrere → Owner wählt eine)' : ' → DECISIONS.md nur als Verweis'}`),
    `- AGENTS.md: ${marker(path.join(root, 'AGENTS.md'), '<!-- project-memory-agents -->')}`,
    `- CLAUDE.md: ${marker(path.join(root, 'CLAUDE.md'), '<!-- project-memory-wegweiser -->')}`,
    `- ${OP_FILE}: ${exists(path.join(root, OP_FILE)) ? 'vorhanden (bleibt unverändert)' : 'fehlt → anlegen (Template)'}`,
    `- Obsidian-Vault: ${exists(path.join(root, '.obsidian')) ? 'ja (.obsidian/ wird bei --sammeln und Lint übergangen)' : 'nein'}`,
    `- Nutzer-Config: ${exists(USER_CONFIG_FILE) ? `${USER_CONFIG_FILE} · Owner ${ownerInfo(lay.data).name}` +
      (userConfig().claude_md_append ? ` · an CLAUDE.md zusätzlich anhängen: ${userConfig().claude_md_append}` : '') : `keine (${USER_CONFIG_FILE}) · Owner „Owner"`}`,
  ].join('\n');
}

// ---------- Einstieg ----------

const argv = process.argv.slice(2);
const CLI = {
  '--sammeln': sammeln,
  '--landkarte': dir => build(dir).then(t => t || '(keine Landkarte: kein memory/ gefunden)'),
  '--geheimnisse': geheimnisse,
  '--fremdtext': fremdtext,
  '--init-pruefen': initPruefen,
};
if (CLI[argv[0]]) {
  const dir = path.resolve(argv[1] || process.cwd());
  CLI[argv[0]](dir)
    .catch(e => `[project-memory] Fehler: ${e.message}`)
    .then(text => { process.stdout.write(text + '\n'); process.exit(0); });
} else {
  let raw = '';
  const timer = setTimeout(() => process.exit(0), 3000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => raw += c);
  process.stdin.on('end', () => {
    clearTimeout(timer);
    let cwd;
    try {
      const input = raw.trim() ? JSON.parse(raw) : {};
      cwd = path.resolve(input.cwd || process.cwd());
    } catch { process.exit(0); }
    let done = false;
    const emit = ctx => {
      if (done) return;
      done = true;
      if (!ctx) process.exit(0);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx }
      }), () => process.exit(0));
    };
    // Notbremse: Landkarte ist Komfort, nie Blocker. Liegt hier ein memory/, fehlt sie aber nie still.
    setTimeout(() => emit(exists(memLayout(cwd, null).dir)
      ? 'PROJEKT-LANDKARTE fehlt (project-memory): Der SessionStart-Hook hat sein Zeitlimit (8 s) überschritten, ' +
        `vermutlich ist der Rechner ausgelastet. Nachladen: \`node "${SELF}" --landkarte .\` oder \`/project-memory weiter\`.`
      : null), 8000).unref();
    build(cwd)
      .catch(() => null) // Landkarte ist Komfort, nie Blocker
      .then(emit);
  });
}
