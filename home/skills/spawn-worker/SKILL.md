---
name: spawn-worker
description: Startet Worker-Terminals als eigenständige Claude-Code-Hintergrund-Sitzungen (claude --bg) aus einem Brain-Terminal und überwacht sie mit minimalem Kontext — für autonome Goal-Läufe, bei denen das Brain Goals schreibt, verteilt und prüft und sein Kontextfenster sauber bleibt. Verwenden bei "spawne einen worker", "starte ein worker-terminal", "lass das ein eigenes terminal machen", "terminal für GOAL-X", "gib das Goal an einen Worker", oder wenn Ausführung aus dem Brain ausgelagert werden soll. NICHT für Subagents (Agent-Tool). Mechanik verifiziert 2026-09-24.
---

# spawn-worker — Worker-Terminals aus dem Brain

Das Brain (Fable, das Leiter-Terminal) redet mit dem Owner, schreibt Goals und Pläne, verteilt sie und nimmt das
Ergebnis ab. Es arbeitet nicht selbst, damit sein Kontextfenster frei bleibt und es viele Goals nacheinander
weitergeben kann. Für jede Arbeit startet es ein Worker-Terminal, auch für die, die Fable braucht: Die bekommt
ein Fable-Worker. Jedes Terminal ist eine eigene Claude-Code-Sitzung im Hintergrund mit eigenem Kontext und
genau einem Goal. Das Brain liest nur kompakte Status-JSON, nie die Ausgaben der Worker. Zwei Skripte — nie
claude-Befehle von Hand zusammensetzen.

**Besetzung** (Regel im Global-Kern, „Subagents und Effort“): Jedes Goal nennt in seiner Kopfzeile genau ein
Modell. `opus` ist der Standard für Goals mit bekanntem Weg. `fable` bekommt ein Goal, dessen Lösungsweg offen
ist, mit einem Satz Begründung in der Kopfzeile. Sonnet und Haiku bekommen kein eigenes Terminal; Kleinkram
gibt der Worker selbst an Subagents ab. Pläne schreibt das Brain; ein eigenes Planer-Terminal gibt es nicht.

Vor dem ersten Start in einer Sitzung `LEHREN.md` in diesem Ordner lesen: Stillstand, Speicher,
Auto-Compact, Aufräumen, Wächter, eine unabhängige Prüfung am Ende.

```bash
S="$HOME/.claude/skills/spawn-worker/scripts"
```

## 1 · Starten

```bash
node "$S/spawn.mjs" --dir "<absoluter projektpfad>" --name <kurzname> --prompt-file <datei>
```

Statt `--prompt-file` geht `--prompt "<text>"`.

| Option | Bedeutung |
|---|---|
| `--role worker` (Standard) | führt aus, Modus `auto`: arbeitet ohne Rückfragen, auch mit Terminal-Befehlen |
| `--model opus\|fable` | **Pflicht**, aus der Kopfzeile des Goals; ohne Angabe verweigert das Skript den Start, weil der Worker sonst still als Fable liefe. **Nie Haiku mit `auto`** (Skript lehnt ab) |
| `--effort low\|medium\|high\|xhigh\|max` | **Pflicht.** Worker-Goals laufen mit `high`, `xhigh` nur bei benannter Fehlerklasse im Goal |
| `--worktree <name>` | eigene Arbeitskopie (Branch `worktree-<name>`), nur für parallele Worker im selben Repo |
| `--watch` | öffnet ein Zuschau-Fenster; Schließen beendet den Worker nicht |
| `--dry-run` | zeigt nur, was gestartet würde |
| `--auto-compact` | schaltet Auto-Compact nur für diesen Worker ein (falls es global aus ist). Pflicht bei Langläufen, sonst endet er mit „Prompt is too long“. Schließt als Altpfad die Merge-Freigabe ein |
| `--merge-main` | erlaubt dem Worker `git merge main` in seinem Zweig |

Ausgabe: eine JSON-Zeile mit `id` und den nächsten Befehlen. Bei `"ok":false` den `error` lesen und
die Ursache beheben, nicht blind wiederholen.

**Auftrag:** Die Substanz gehört in eine committete Datei im Repo (Wiedereinstiegs-Anker bei Absturz),
der Prompt bleibt kurz, zum Beispiel:
`Lies und führe aus: <pfad>. Committe deine Arbeit. Schreib deinen Schlussbericht nach <pfad ohne .md>-BERICHT.md,
committe ihn, melde dein Ende per SendMessage an <Name des Brains> mit einem Satz Ergebnis und dem Pfad des Berichts
und antworte am Ende mit demselben Satz.`
So liest der Owner den ganzen Bericht als Datei, und ins Brain kommt nur ein Satz (die Status-Ausgabe kürzt die
letzte Antwort ohnehin nach 2000 Zeichen). Der Prompt darf nicht mit `-` beginnen; sonst kommt jedes Zeichen byte-genau an (belegt).

## 2 · Überwachen — die Brain-Schleife

1. Starten, `id` merken.
2. Warten **im Hintergrund** (Bash-Tool mit `run_in_background: true`):
   `node "$S/status.mjs" --wait <id> --timeout 28800`
   Der Befehl endet, sobald der Worker fertig ist oder hängt, und liefert Zustand und letzte Antwort.
   Keine eigene Poll-Schleife, kein `sleep`. Standard-Zeitlimit 4 h, Exit 3 bei Ablauf.
3. Auswerten:

| `state` | Bedeutung | Brain tut |
|---|---|---|
| `working` (`busy`) | arbeitet | nichts |
| `done` (`idle`) | fertig, oder der Worker hat mit einer Frage geendet | `lastMessage` lesen. Ist es eine Frage: antworten (Abschnitt 3). Ist es ein Ergebnis: prüfen lassen — ein „fertig" ist der Anfang der Prüfung |
| `blocked` | hängt an einer Rückfrage (`waitingFor`) | `node "$S/status.mjs" --logs <id> --lines 30` lesen, dann antworten (Abschnitt 3) |
| `failed` | abgebrochen | `--logs` lesen, Reste im Arbeitsordner sichten und sichern, Ursache beheben, dann fortsetzen (Abschnitt 3) oder neu starten |
| `stopped` | gestoppt | klären, wer gestoppt hat; Arbeit sichern, dann fortsetzen (Abschnitt 3) |

   **Prüfen lassen:** Das Brain liest Diffs und Testausgaben nicht selbst, das würde sein Fenster füllen. Es
   schickt einen Prüf-Subagent los (Sonnet; bei Rechten, Daten, Geld und Unumkehrbarem Opus, siehe Global-Kern).
   Der prüft Commits, Tests und die Szenen des Goals am echten Ergebnis und antwortet in höchstens fünf Zeilen:
   je Szene erfüllt oder nicht, mit Beleg. Den vollen Befund schreibt er nach `<pfad ohne .md>-PRUEFUNG.md`.

   **Nachbessern in einem neuen Terminal:** Fehlt etwas, bessert ein frischer Worker nach, nicht der alte.
   Dessen Fenster ist nach einer langen Aufgabe voll; der neue bekommt nur, was er braucht. Startsatz:
   `Lies <goal>, <bericht> und <prüfbefund>. Behebe die offenen Punkte aus dem Prüfbefund, committe, ergänze
   den Bericht und antworte am Ende mit einem Satz Ergebnis.` Danach wird erneut geprüft. Nach zwei
   Nachbesserungen ohne Abnahme hält das Brain an und fragt den Owner.

4. Aufräumen: `node "$S/status.mjs" --remove <id>` (stoppt und entfernt in einem Schritt). Hat der Worker
   Antworten bekommen, gibt es mehrere Kennungen; alle entfernen, die jüngste zuerst.

Außerdem: `node "$S/status.mjs"` listet alle Hintergrund-Sitzungen, `--id <id>` zeigt eine.
Menschen schauen mit `claude attach <id>` zu oder greifen ein; `claude agents` ist die Übersicht.

## 3 · Nachrichten zwischen Brain und Worker

**Brain an Worker** — eine Rückfrage mitten in der Arbeit beantworten oder eine abgebrochene Sitzung
fortsetzen (Nachbessern nach einer Prüfung läuft nicht hierüber, sondern in einem neuen Terminal, Abschnitt 2):

```bash
node "$S/status.mjs" --send <id> --message "<antwort>"      # oder --message-file <datei>
```

Der Worker arbeitet mit seinem ganzen bisherigen Verlauf weiter; nichts beginnt von vorn. Modell, Modus und
die Worker-Settings des Starts bleiben erhalten (belegt 13.11.2026, CLI 2.1.323). Die CLI führt die
Fortsetzung als Kopie unter neuer Kennung und dem Namen `<name>-f2`: Die Ausgabe nennt die neue `id`, auf die
ab jetzt gewartet wird; das Original bleibt bis zum Aufräumen stehen. Eine Sitzung, die noch arbeitet, nimmt
keine Nachricht an (das Skript lehnt ab), sonst gäbe es zwei Schreiber im selben Ordner. Den Effort gibst du
mit `--effort <stufe>` wieder an; ob die CLI ihn von selbst behält, ist nicht belegt.

Was das Brain aus Goal und Entscheidungen beantworten kann, beantwortet es selbst. Was nur der Owner entscheiden
kann, fragt es ihn und schickt seine Antwort weiter. Ein Neustart mit neuem Auftrag ist nur richtig, wenn der
Worker auf dem falschen Weg ist und sein Verlauf mehr schadet als nützt.

**Worker an Brain** — der Schlusssatz, die Berichtsdatei und eine direkte Nachricht. Am Ende meldet sich der
Worker per `SendMessage` beim Brain (Satz dazu im Auftrag, Abschnitt 1). Seinen eigenen Namen liest das Brain aus
der ersten Zeile von `ListAgents` und setzt ihn in den Auftrag ein. Die Nachricht kommt in der laufenden
Brain-Sitzung an, ohne Kopie (belegt 15.11.2026, CLI 2.1.325). Worker und Brain laufen dafür im selben Modus
(`auto`), sonst hält der Empfänger die Nachricht zur Freigabe zurück. `--wait` bleibt als Netz im Hintergrund: Es
meldet auch einen Worker, der abstürzt, hängt oder mit einer Frage endet. Über `claude -p --resume` schreiben
Worker weder dem Brain noch einander: Auf eine registrierte Sitzung trifft das nicht die laufende Sitzung,
sondern legt eine Kopie davon an (belegt für `--bg --resume`). Abstimmung zwischen Workern läuft über das Brain.

## 4 · Belegte Grenzen (verifiziert 2026-09-24, nicht umgehen)

- **Vertrauen:** Jeder Projektordner (bei Git: das Repo) muss einmal von Hand in Claude geöffnet und
  als vertrauenswürdig bestätigt worden sein, sonst bricht der Start mit „Workspace not trusted" ab.
  Einmal pro Projekt, nicht pro Terminal. Worktrees erben das Vertrauen ihres Repos; ein eigenes
  Git-Repo erbt es nicht von einem vertrauten Elternordner.
- **MCP:** Das Skript übernimmt die MCP-Freigaben des Projekts. Nie beantwortete `.mcp.json`-Server
  schaltet es für den Worker ab — sonst hinge er an der Freigabe-Frage.
- **Auto-Modus:** greift mit Sonnet, Opus und Fable. Mit Haiku fällt er still auf Rückfragen zurück.
- **Ein Repo, ein Schreiber:** Ohne `--worktree` nie zwei Worker im selben Repo, und das Brain schreibt
  dort nicht, solange ein Worker läuft. Worktrees trennen keine Ports, Datenbanken oder Emulatoren.
- **Aufräumen schützt Arbeit:** `--remove` verweigert (Exit 5), solange ein Worktree nicht committete
  Änderungen oder nirgends gepushte Commits hat. Ein Worker pusht seinen eigenen Branch selbst
  (globale Grenze); danach lässt sich sein Worktree entfernen. Auf `main` pusht nur
  der Owner. Nie `--discard-unpushed` ohne Owner-Freigabe.
- **Fertige Worker** bleiben als Sitzung (`idle`) bestehen, bis sie entfernt werden.
- **Kontingent:** Hintergrund-Sitzungen zählen auf dasselbe Nutzungslimit wie das Brain.

## 5 · Für Nacht- und Langläufe

- Mehrere Goals gibt das Brain nacheinander weiter: ein Worker im Hauptordner, er committet, das Brain
  prüft an Belegen, dann das nächste Goal. Parallel nur mit `--worktree` und klar getrennten Aufgaben.
- Auftragsdatei vor dem Start pfadbegrenzt committen: `git add <datei> && git commit -m "…" -- <datei>`.
- Kein „erkläre dein Vorgehen" im Auftrag — nach Ergebnissen und Belegen fragen.
- Das Brain selbst läuft im Modus `auto`, sonst bleibt es an seinen eigenen Rückfragen stehen.
