---
name: einrichtung
description: Richtet das claude-starterpack auf diesem Rechner ein – prüft Node, git und Claude Code, kopiert die globale CLAUDE.md, die Brain-Regel und die Skills xyzgoal, spawn-worker, project-memory und einfuehrung nach ~/.claude, sichert Vorhandenes, trägt den Start-Hook ein und legt den Übungsordner an. Verwenden bei „/einrichtung“, „richte mich ein“, „installieren“, „setup“, „einrichten“.
---

# Einrichtung

Am Ende liegt das Starterpack in `~/.claude`, alles ist geprüft, ein Übungsordner steht bereit, und der Nutzer weiß
genau, was er als Nächstes tippt. Er kann Einsteiger sein: Erkläre jeden Schritt in einem Satz, ohne Fachjargon,
und frag nur, was du nicht selbst prüfen kannst.

Das Werkzeug ist ein Skript in diesem Repo. Es schreibt nichts ohne Sicherung und gibt immer eine JSON-Zeile aus:

```bash
E=".claude/skills/einrichtung/scripts/einrichten.mjs"   # relativ zum Repo-Ordner dieser Sitzung
```

Setze nie Dateien in `~/.claude` von Hand zusammen; alles läuft über dieses Skript.

## 1. Voraussetzungen prüfen

`node "$E" --pruefen` (vor der Einrichtung sind `dateien`, `CLAUDE.md` und `start-hook` natürlich noch rot).

- `node`, `git`, `claude` oder `claude --bg` rot → sag in einfachen Worten, was fehlt, nenn den `hinweis` mit Link
  und hör hier auf. Danach geht es mit `/einrichtung` von vorn weiter.
- Fehlt nur `claude`, obwohl der Nutzer Claude gerade benutzt, ist es meist eine npm-Installation (`.cmd`).
  spawn-worker braucht den nativen Installer; erklär das und verweis auf den Link.

## 2. Zwei Fragen

1. „Wie soll Claude dich nennen?“ — normal im Chat fragen.
2. Ein Übungsordner für die Einführung: Schlag `~/claude-uebung` vor und frag nur, ob das passt.

## 3. Probelauf und Plan

`node "$E" --name "<Name>" --uebung "<ordner>" --dry-run`

Erzähl den Plan in Klartext: was neu dazukommt, was ersetzt wird (mit Sicherung), ob der Start-Hook eingetragen
wird und wo der Übungsordner entsteht. Ein Satz zum Start-Hook: Er lädt bei jedem Start den Stand des Projekts, in
dem man gerade arbeitet, aus dessen `memory/`-Ordner; er sendet nichts ins Netz.

**Hat der Nutzer schon eine eigene `~/.claude/CLAUDE.md`** (`plan.claudeMd` = `vorhanden-neue-fassung-daneben`):
Lies sie, fass sie in drei bis fünf Stichpunkten zusammen und frag:

- **Zusammenführen (Empfehlung):** Seine Datei bleibt, die neue Fassung landet als `~/.claude/CLAUDE.md.starterpack`
  daneben. Nach der Einrichtung führst du beide zusammen, zeigst ihm das Ergebnis vollständig und schreibst erst nach
  seinem Go; danach `CLAUDE.md.starterpack` löschen.
- **Ersetzen:** `--claude-md ersetzen`; die alte Datei kommt in die Sicherung.

Will er keinen Start-Hook: `--ohne-hook` (dann lädt `/project-memory weiter` die Landkarte von Hand).

Hol ein klares Go, bevor du einrichtest.

## 4. Einrichten und prüfen

1. `node "$E" --name "<Name>" --uebung "<ordner>" [--claude-md ersetzen] [--ohne-hook]`
2. Bei `"ok":false`: Fehler in einfachen Worten erklären. Bei kaputter `settings.json` nichts selbst reparieren,
   sondern die Stelle zeigen und mit dem Nutzer klären.
3. `node "$E" --pruefen` — alles grün (der Start-Hook darf fehlen, wenn er ihn nicht wollte).
4. Falls zusammenführen gewählt: jetzt zusammenführen wie oben beschrieben.

## 5. Abschluss

Sag kurz und genau:

- **Fertig:** was eingerichtet ist (CLAUDE.md, Brain-Regel, Skills `xyzgoal`, `spawn-worker`, `project-memory`,
  `einfuehrung`, Start-Hook) und wo der Übungsordner liegt.
- **Zurücknehmen:** Die Sicherung liegt unter `sicherung`; der Befehl aus `rueckgaengig` stellt alles so her, wie es
  vorher war.
- **Weiter geht es mit der Einführung, in einem neuen Terminal:**

  ```
  cd <Übungsordner>
  claude
  ```

  Beim ersten Start fragt Claude, ob es dem Ordner vertrauen darf: mit Ja bestätigen. Dann `/einfuehrung` tippen.
  Diese Sitzung hier kann er schließen (`/exit`).
