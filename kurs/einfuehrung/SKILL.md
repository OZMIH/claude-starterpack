---
name: einfuehrung
description: Führt Schritt für Schritt in die Brain-Worker-Formel des claude-starterpack ein – vier Stationen im Übungsordner (Gedächtnis anlegen, Goal klären, echten Worker bauen lassen und prüfen, Übergabe und Wiedereinstieg), danach ein Spickzettel. Erkennt selbst, bei welcher Station der Nutzer steht. Verwenden bei „/einfuehrung“, „einführung“, „zeig mir wie das geht“, „tutorial“, „wie arbeite ich damit“.
---

# Einführung in die Formel

Du bist Lehrer und Brain zugleich. Der Nutzer lernt die Formel, indem er sie einmal ganz durchläuft — an einem
winzigen Projekt, aber mit echten Werkzeugen. Je Station: zuerst in zwei, drei Sätzen das **Warum**, dann macht er
es selbst, dann ein Satz, was gerade passiert ist. Einfache Sprache, keine Fachbegriffe ohne Erklärung, keine
Textwände. Warte nach jeder Station auf ein „weiter“.

## 0. Wo stehen wir?

Prüfe still, dann sag es in einem Satz:

- **Richtiger Ordner?** Diese Sitzung muss im Übungsordner laufen (ein git-Repo, angelegt von `/einrichtung`,
  meist `~/claude-uebung`). Läuft sie im Starterpack-Repo oder in einem echten Projekt: Sag, dass die Übung dort
  nichts kaputt machen soll, und nenne den Weg (`cd ~/claude-uebung`, `claude`, `/einfuehrung`). Fehlt der Ordner,
  leg ihn mit dem Nutzer an: `git init`, eine `README.md`, erster Commit.
- **Station** aus dem Ordnerinhalt:

| Zustand | weiter bei |
|---|---|
| kein `memory/` | Station 1 |
| `memory/` da, kein `goals/GOAL-*.md` | Station 2 |
| Goal da, kein `goals/*-BERICHT.md` | Station 3 |
| Bericht da, kein `memory/sessions/SESSION-*.md` | Station 4 |
| alles da | Abschluss |

Beim allerersten Start (Station 1) zeig vorher das Bild der Formel und erklär es in vier Sätzen:

```
  Du ──► Brain (diese Sitzung): klärt mit dir das Ziel, schreibt das Goal, prüft am Ende
           ▼
         Worker (eigene Hintergrund-Sitzung): baut das Goal allein, committet, schreibt einen Bericht
           ▼
         Brain prüft an Belegen ──► Gedächtnis (memory/) hält fest, wo du stehst
```

Kernsätze: Das Brain baut nicht selbst, damit es den Überblick behält. Ein Goal sagt, *was* am Ende da sein soll,
nie *wie*. „Fertig“ heißt belegt, nicht behauptet.

## Station 1 — Das Gedächtnis

**Warum:** Claude vergisst zwischen Sitzungen alles. `memory/` im Projekt ist das Notizbuch, das jede neue Sitzung
als Erstes liest: wohin das Projekt will, wo du stehst, was als Nächstes kommt.

1. Lass ihn `/project-memory init` tippen. Bei der Frage nach Projekt und Vision ein Vorschlag, falls ihm nichts
   einfällt: „Hallo-Seite — eine kleine Webseite, die mich begrüßt. Übung für die Formel.“
2. Danach zeig ihm kurz, was entstanden ist (`memory/VISION.md`, `INDEX.md`, `NEXT-STEPS.md`), je ein Halbsatz.
3. Kleine Übung: `/project-memory note "Farbe der Seite später entscheiden"` — eine Notiz für später.

## Station 2 — Das Goal

**Warum:** Ein Worker arbeitet allein. Er braucht ein Ziel, das so klar ist, dass „fertig“ prüfbar wird. Dafür
erzählt der Nutzer, was er am Ende sehen will, und Claude macht daraus Szenen: „Ich tue X, ich sehe Y.“

1. Lass ihn `/xyzgoal` tippen. Ist er unsicher, ein Beispiel: „Ich öffne `index.html` im Browser und sehe groß
   ‚Hallo <Name>‘, darunter das heutige Datum.“ Halt es klein: eine Datei, zwei, drei Szenen.
2. Die Goal-Datei kommt nach `goals/GOAL-hallo.md` (mit der Worker-Preamble darunter) und wird committet —
   xyzgoal macht das nach seinem Okay.
3. Ein Satz dazu: Die Preamble am Ende des Goals ist die Arbeitsanweisung für den Worker (ehrlich berichten,
   committen, aufräumen).

## Station 3 — Der Worker

**Warum:** Jetzt baut nicht diese Sitzung, sondern ein eigenes Terminal im Hintergrund. So bleibt das Brain frei
und könnte nebenher das nächste Goal schreiben.

**Vorher sagen und ein Go holen:** Der Worker ist eine echte Claude-Sitzung (Modell Opus). Er verbraucht etwas von
seinem Nutzungskontingent — bei dieser Mini-Aufgabe wenig — und arbeitet ohne Rückfragen im Übungsordner.

1. Starten (Skill `spawn-worker`), mit dem absoluten Pfad des Übungsordners:

   ```bash
   S="$HOME/.claude/skills/spawn-worker/scripts"
   node "$S/spawn.mjs" --dir "<Übungsordner>" --name hallo --model opus --effort high \
     --prompt "Lies und führe aus: goals/GOAL-hallo.md. Committe deine Arbeit. Schreib deinen Schlussbericht nach goals/GOAL-hallo-BERICHT.md, committe ihn und antworte am Ende mit einem Satz Ergebnis."
   ```

   Bei `"ok":false` den `error` in einfachen Worten erklären (häufig: Ordner noch nicht als vertrauenswürdig
   bestätigt → einmal `claude` in diesem Ordner starten und mit Ja bestätigen; das ist hier schon passiert, wenn
   diese Sitzung im Übungsordner läuft).
2. Warten **im Hintergrund**: `node "$S/status.mjs" --wait <id> --timeout 1800`. Währenddessen: Er kann zuschauen
   mit `claude attach <id>` in einem zweiten Terminal (Schließen beendet den Worker nicht). Erklär solange, was
   der Worker gerade tut: Goal lesen, bauen, committen, Bericht schreiben.
3. Meldet `--wait` eine Frage (`blocked` oder eine Frage in `lastMessage`): gemeinsam beantworten mit
   `node "$S/status.mjs" --send <id> --message "<antwort>"` und erneut warten.
4. **Prüfen an Belegen:** Starte einen Prüf-Subagent (Modell Sonnet) mit dem Auftrag: „Prüfe im Ordner
   <Übungsordner> jede Szene aus goals/GOAL-hallo.md am echten Ergebnis (Dateien, git log). Antworte in höchstens
   fünf Zeilen: je Szene erfüllt oder nicht, mit Beleg.“ Zeig dem Nutzer das Ergebnis und erklär: Das Brain glaubt
   nicht der Zusammenfassung des Workers, sondern prüft nach.
5. **Selbst ansehen:** Lass ihn `index.html` öffnen (Windows: `start index.html`, macOS: `open index.html`).
   Fertig heißt: Er sieht es selbst.
6. Aufräumen: `node "$S/status.mjs" --remove <id>`. Ein Satz: Fertige Worker bleiben sonst als Sitzung liegen.

Fehlt eine Szene: Das ist eine gute Lektion. Ein frischer Worker bessert nach (gleicher Start, Prompt: „Lies
goals/GOAL-hallo.md und den Prüfbefund. Behebe die offenen Punkte, committe und antworte mit einem Satz.“).

## Station 4 — Übergabe und Wiedereinstieg

**Warum:** Am Ende einer Sitzung sichert die Übergabe, was passiert ist, damit die nächste Sitzung nahtlos
weitermacht — auch Tage später, auch mit einem anderen Modell.

1. Lass ihn `/project-memory übergabe` tippen; bestätigen, was vorgeschlagen wird. Danach ist `memory/` committet.
2. Jetzt der Beweis: Er beendet diese Sitzung (`/exit`) und startet im selben Ordner neu (`claude`). Der Start-Hook
   lädt die Landkarte von selbst (ohne Hook: `/project-memory weiter`). Er fragt die neue Sitzung: „Wo waren wir?“
   — sie weiß es. Danach `/einfuehrung` für den Abschluss.

## Abschluss

Gratulier kurz (ein Satz, kein Lob-Schwall) und gib den Spickzettel:

```
DEINE FORMEL
  Neues Projekt     /project-memory init
  Ziel klären       /xyzgoal                → Goal-Datei mit Szenen
  Bauen lassen      „Gib das Goal an einen Worker“   (spawn-worker)
  Prüfen            Brain prüft an Belegen, du schaust dir das Ergebnis an
  Sitzungsende      /project-memory übergabe
  Wiedereinstieg    /project-memory weiter  (oder „wo waren wir?“)
  Notiz zwischendurch  /project-memory note "…"

REGELN, DIE DIR VIEL ÄRGER SPAREN
  Ein Ordner, ein Schreiber: nie zwei Worker im selben Repo ohne eigenen Worktree
  Fertig heißt belegt: Commits, Test, selbst angesehen
  Worker nur in Repos, deren Stand in git gesichert ist
```

Zum Schluss drei Hinweise:

- Seine Regeln stehen in `~/.claude/CLAUDE.md` — er darf sie anpassen; „Owner“ meint ihn.
- Für ein echtes Projekt: im Projektordner `claude` starten, dann wie oben.
- Den Übungsordner kann er behalten oder löschen; die Einführung kann er jederzeit mit `/einfuehrung` wiederholen
  (in einem neuen, leeren Übungsordner).
