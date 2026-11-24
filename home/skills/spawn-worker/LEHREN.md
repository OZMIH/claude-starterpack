# Orchestrierung · Lehren für Brain-Sitzungen mit Hintergrund-Terminals

Gilt für jede Brain-Sitzung, die Worker oder Planer per spawn-worker steuert, in allen Projekten. Grundsatz: Was stundenlang bremst, wird sofort gelöst.

1. **Stillstand höchstens 15 Minuten.**
   - Ein Terminal ohne neue Ausgabe, ein Terminal an einer Sperre oder im Warten auf Speicher: Die Brain-Sitzung prüft und löst aktiv.
   - Werkzeuge dafür sind eine Nachricht an das Terminal, das Freigeben einer verwaisten Sperre nach der Lebendprüfung, ein Fortsetzungs-Worker oder Umplanen.
   - Eine Wartebedingung ohne Zeitlimit gibt es nicht.
2. **Werkzeuge frei verbessern.** Die Brain-Sitzung ändert ihre eigenen Werkzeuge ohne Rückfrage, solange nichts kaputtgeht und die Änderung im Journal steht: Wächter, Skripte, Ablaufregeln, `spawn.mjs`, Worker-Settings.
3. **Auto-Compact für Worker.** Ist `autoCompactEnabled` global aus, schaltet die Brain-Sitzung es in den Settings jedes Workers ein. Sonst endet ein langer Worker mit „Prompt is too long“.
4. **Worker klein schneiden.** Eine Etappe je Sitzung, eine Übergabe-Notiz je Etappe. Große Ausgaben gehen in Dateien, gelesen wird nur `tail` oder `grep`.
5. **Speicher richtig messen.** Maßgeblich ist `AvailableMBytes` (frei plus Standby) und der Commit-Abstand, nicht `FreePhysicalMemory`. Ändert sich eine Schwelle, bekommen laufende Terminals die neue Regel per Nachricht, sonst warten sie nach der alten.
6. **Hintergrund-Shells ruhender Sitzungen** beendet Claude Code bei Speicherknappheit. Schwere Aktionen unter 10 Minuten laufen deshalb im Vordergrund, längere im Hintergrund mit aktivem Warten.
7. **Aufräumen nach jedem Terminal.** Nach `--remove` auch das Zuschau-Fenster schließen: Win32_Process mit „claude attach <id>“. Tote Fenster fressen Speicher.
8. **Wächter:**
   - **Planer:** Erst nach 90 s stabilem `planReady` gilt ein Planer als fertig, weil Planer danach oft noch kürzen.
   - **Worker:** „done“ zählt nur mit Schlussantwort oder nach Ruhe.
9. **Eine unabhängige Prüfung am Ende.** Ein anderes Modell (Codex) prüft den festen Endcommit einmal; es findet Randfälle wie Paging, Cache und Zustände, die eigene Tests übersehen. Ein zusätzliches Verify-Terminal gibt es nicht.
10. **„Fertig“ an Belegen prüfen.** Die Brain-Sitzung prüft Commits, Status und Testprotokoll, nicht die Zusammenfassung. Reste abgebrochener Terminals werden gesichtet und gesichert, nie verworfen.
