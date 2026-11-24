# claude-starterpack

Meine persönliche Claude-Code-Bibliothek: die globale `CLAUDE.md` und die drei Skills, mit denen ich jeden Tag
arbeite — mit geführter Einrichtung und einer Einführung zum Mitmachen.

*English:* My personal Claude Code setup (German): a global `CLAUDE.md` plus skills for goal writing, autonomous
background workers and per-repo project memory. Open the repo in Claude Code and run `/einrichtung`.

## So geht's

Voraussetzungen: [Claude Code](https://docs.claude.com/en/docs/claude-code) (nativer Installer), Node.js 18+ und
git. Getestet mit Claude Code 2.1.331 unter Windows 11.

```
git clone https://github.com/OZMIH/claude-starterpack
cd claude-starterpack
claude
```

Dann in Claude: **`/einrichtung`**. Claude prüft deinen Rechner, fragt deinen Namen, kopiert alles nach
`~/.claude`, sichert vorher, was schon da ist, trägt den Start-Hook ein und legt einen Übungsordner an.

Danach in einem neuen Terminal:

```
cd ~/claude-uebung
claude
```

und **`/einfuehrung`**. Vier kurze Stationen an einem Mini-Projekt:

1. **Gedächtnis** — `/project-memory init`: das Notizbuch des Projekts, das jede Sitzung zuerst liest.
2. **Goal** — `/xyzgoal`: du erzählst, was am Ende da sein soll; heraus kommt ein prüfbares Ziel.
3. **Worker** — ein eigenes Claude-Terminal baut das Ziel allein; das Brain prüft das Ergebnis an Belegen.
4. **Übergabe** — `/project-memory übergabe`, neu starten, und die neue Sitzung weiß, wo du stehst.

Station 3 startet eine echte Opus-Sitzung im Hintergrund und verbraucht etwas von deinem Nutzungskontingent.

## Die Formel

```
  Du ──► Brain (Dialog)
           │  /xyzgoal       Endresultat klären → Goal-Datei mit Szenen und "Fertig heißt"
           │  spawn-worker   Goal an ein Worker-Terminal (eigene Hintergrund-Sitzung)
           ▼
         Worker ──► baut autonom, committet, schreibt Bericht
           │
           ▼
         Brain ──► Prüf-Subagent prüft die Szenen an Commits und Tests
           │       fehlt etwas → frischer Worker bessert nach
           ▼
  /project-memory übergabe ──► Stand, Entscheidungen, Lehren ins memory/ des Repos
```

- **Das Brain baut nicht selbst.** Es redet mit dir, schreibt Goals und prüft. So bleibt sein Kontext frei.
- **Ein Goal sagt das Was, nie das Wie.** Szenen wie „Ich tue X, ich sehe Y“ machen „fertig“ prüfbar.
- **Fertig heißt belegt.** Commits, Testausgabe, die laufende App — nicht die Zusammenfassung eines Workers.

Wie gedacht: **Fable** als Brain, **Opus** als Worker. Ohne Fable läuft das Brain auf Opus. **Codex** für das
Audit am Ende langer Läufe ist optional.

## Was drin ist

```
home/                          → kommt nach ~/.claude
  CLAUDE.md.vorlage            globale CLAUDE.md (wird als CLAUDE.md installiert, mit deinem Namen)
  rules/brain-mode.md          Haltung und Antwortformat im Dialog
  skills/xyzgoal/              Goal klären und schreiben (+ Worker-Preamble)
  skills/spawn-worker/         Worker-Terminals starten, überwachen, beantworten, aufräumen
  skills/project-memory/       Gedächtnis: weiter, übergabe, note, merke, init, lint, status
kurs/einfuehrung/              die Einführung (wird als Skill mit installiert)
.claude/skills/einrichtung/    die geführte Einrichtung
```

## Zurücknehmen

`/einrichtung` legt vor jeder Änderung eine Sicherung unter `~/.claude/starterpack-sicherung-<datum>/` an und nennt
am Ende den Befehl, der alles wieder herstellt:

```
node .claude/skills/einrichtung/scripts/einrichten.mjs --rueckgaengig "<sicherungsordner>"
```

## Von Hand einrichten (ohne Claude)

Inhalt von `home/` nach `~/.claude` kopieren, dabei `CLAUDE.md.vorlage` als `CLAUDE.md` speichern und
`<DEIN NAME>` ersetzen; `kurs/einfuehrung` nach `~/.claude/skills/einfuehrung`. Eine vorhandene `CLAUDE.md`
nicht überschreiben, sondern zusammenführen. Optional den Start-Hook in `~/.claude/settings.json` unter `"hooks"`:

```json
"SessionStart": [
  {
    "matcher": "startup|resume|clear|compact",
    "hooks": [
      {
        "type": "command",
        "command": "node \"$HOME/.claude/skills/project-memory/scripts/project-memory-landkarte.js\"",
        "timeout": 15,
        "statusMessage": "Projekt-Landkarte laden..."
      }
    ]
  }
]
```

## Was auf deinem Rechner passiert

Die Skripte machen keine Netzwerkaufrufe und keine Telemetrie. Trotzdem gut zu wissen:

- **Worker arbeiten ohne Rückfrage.** `spawn-worker` startet Hintergrund-Sitzungen standardmäßig im Rechte-Modus
  `auto`: Sie bearbeiten Dateien und führen Terminal-Befehle aus, ohne zu fragen. `--mode` erlaubt auch
  `bypassPermissions`, das jede Sicherheitsabfrage abschaltet — nur nutzen, wenn du genau weißt, warum. Worker nur
  in Repos starten, deren Stand in git gesichert ist.
- **Worker verbrauchen dein Kontingent** wie eine normale Sitzung; parallele Worker entsprechend mehr.
- **Mit `--merge-main` oder `--auto-compact`** darf ein Worker `git merge main` in seinem eigenen Zweig ohne
  Rückfrage ausführen.
- **Der Start-Hook** liest bei jeder Sitzung das `memory/` des Repos, git-Informationen aller Worktrees, die
  Prozessliste und die Statusdateien der Hintergrund-Sitzungen unter `~/.claude/jobs`. Er schreibt nichts ins Repo.
  Einzige Ausnahme außerhalb: In einem Nebenworktree legt er unter `~/.claude/projects/` eine Verknüpfung auf die
  Auto-Memory des Haupt-Worktrees an, wenn der eigene Ordner dort fehlt oder leer ist.
- **`/project-memory übergabe`** committet nur den Ordner `memory/` (plus, nach deinem Go, die Entscheidungsdatei
  des Repos), nie anderen Code.
- `spawn-worker --watch` und das Schließen der Zuschau-Fenster nutzen PowerShell (Windows). Alles andere ist Node,
  auf macOS/Linux aber nicht getestet.

## Lizenz

[MIT](LICENSE)
