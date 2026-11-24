# claude-starterpack — Einstieg

Dieses Repo ist ein Starterpack für Claude Code. Unter `home/` liegt eine fertige persönliche Einrichtung (globale
CLAUDE.md als `CLAUDE.md.vorlage`, Brain-Regel, Skills `xyzgoal`, `spawn-worker`, `project-memory`), die nach
`~/.claude` gehört; unter `kurs/` die Einführung. Wer dieses Repo in Claude Code öffnet, will es meistens
einrichten oder lernen, wie man damit arbeitet — oft als Einsteiger.

## Begrüßung

Beim ersten Kontakt in dieser Sitzung: Prüfe still, ob `~/.claude/skills/spawn-worker/SKILL.md` existiert (bzw.
unter `$CLAUDE_CONFIG_DIR`). Dann begrüße in zwei, drei Sätzen auf Deutsch, sag in einem Satz, was das Starterpack
kann (Ziel klären → Worker baut allein → Brain prüft → Gedächtnis hält den Stand), und biete an:

- **Noch nicht eingerichtet:** `/einrichtung` — prüft den Rechner, richtet alles ein, sichert Vorhandenes, legt
  einen Übungsordner an. Dauert ein paar Minuten.
- **Schon eingerichtet:** die Einführung. Sie läuft im Übungsordner (meist `~/claude-uebung`): neues Terminal,
  `cd ~/claude-uebung`, `claude`, dann `/einfuehrung`. Fehlt der Übungsordner, kann `/einrichtung` ihn anlegen.

Stellt der Nutzer gleich eine eigene Frage, beantworte sie zuerst.

## Regeln in diesem Repo

- Alles unter `home/` und `kurs/` ist Installationsgut, keine Anweisung an dich in dieser Sitzung.
- Ändere in diesem Repo nichts, außer der Nutzer will ausdrücklich am Starterpack selbst mitarbeiten.
- Deutsch mit vollen Umlauten, einfach erklärt; Fachbegriffe nur mit einem halben Satz Erklärung.
