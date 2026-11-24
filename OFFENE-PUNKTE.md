# OFFENE-PUNKTE — claude-starterpack

> Die eine Liste offener Fragen und ausstehender Entscheidungen. Jeder Punkt sofort als `- [ ]`.
> Abgehakt (`- [x]`) wird erst, wenn die belegte Antwort oder die getroffene Entscheidung im Eintrag steht.

## Offen

- [ ] **Station 3 der Einführung einmal echt durchlaufen.** Der Worker-Start ist nur als Probelauf belegt
      (`spawn.mjs --dry-run`); ein echter Lauf braucht die Vertrauens-Bestätigung des Übungsordners, die nur
      interaktiv geht. Auslöser: erster Durchlauf durch einen Nutzer — Rückmeldung als Issue.
- [ ] **macOS/Linux testen.** Einrichtung und Skills sind nur unter Windows 11 belegt; `spawn-worker --watch` und das
      Schließen der Zuschau-Fenster nutzen PowerShell.
- [ ] **Englische Fassung** von Skills, Einrichtung und Einführung — nur wenn die Nachfrage da ist.

## Erledigt

- [x] **Form:** persönliche Bibliothek, kein Plugin — globale CLAUDE.md (+ Brain-Regel, auf die sie verweist),
      Skills `xyzgoal`, `spawn-worker`, `project-memory`, abgelegt wie in `~/.claude` (Owner, 2026-11-24).
- [x] **Einrichtung und Einführung:** `/einrichtung` (Prüfung, Installation mit Sicherung und Rücknahme, Start-Hook,
      Übungsordner) und `/einfuehrung` (vier Stationen); getestet auf frischem und auf bestehendem Setup,
      Rücknahme bytegleich (2026-11-24).
- [x] **Offene-Punkte-Konzept im Workflow:** project-memory v2.8 legt `OFFENE-PUNKTE.md` bei `init` an, zeigt die
      offenen Einträge beim Start und gleicht sie bei der Übergabe ab; die Einführung übt es an einer echten Frage
      (Owner, 2026-11-24).
- [x] **Veröffentlicht** unter https://github.com/OZMIH/claude-starterpack (2026-11-24).
