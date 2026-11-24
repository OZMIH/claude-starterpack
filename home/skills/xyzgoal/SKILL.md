---
name: xyzgoal
description: Klärt im kurzen Hin und Her mit dem Owner, wie das Endresultat aussehen soll, und schreibt daraus ein kurzes Goal, das ein Worker autonom bis fertig bauen kann. Verwenden bei „goal“, „nächstes goal“, „goal für X“, „schreib das Goal“, „goalmap“, in jedem Repo.
---

# xyzgoal

Erst gemeinsam das Endresultat klären, dann ein kurzes Goal schreiben. Der Owner sagt, was am Ende da sein soll;
der Worker entscheidet, wie er dorthin kommt. Im Goal steht deshalb nie ein Wie.

## 1. Lesen, bevor du fragst

- Was der Owner gesagt oder mitgegeben hat, und der echte Stand des Projekts (Code, git, seine Regeln und
  Entscheidungen). Was dort schon beantwortet ist, fragst du nicht noch einmal.
- Gab es einen Vorlauf: dessen Schlussbericht. Offene Szenen kommen ins neue Goal, oder du sagst dem Owner, was
  bewusst draußen bleibt. Nichts verschwindet still.
- Ein Owner-Profil, falls es eines gibt (etwa `.claude/rules/owner-profil.md` im Repo oder in `~/.claude/rules/`).
  Es regelt, wie Fragen beim Owner ankommen und wann du selbst entscheidest.

## 2. Hin und Her zum Endresultat

**Steht das Ziel schon fest** (eigener Zieltext des Owners oder ein `GOAL.md` im Repo), entfällt das Erzählen. Dann
klärst du nur, was für diesen Lauf offen ist: was zuerst fertig sein soll, woran „fertig“ belegt wird, was nicht
angefasst wird. Das Goal wird ein kurzer Lauf-Auftrag in derselben Form; Pläne und Reihenfolgen aus dem Repo
verlinkst du, statt sie abzuschreiben.

**Erst erzählen lassen, dann klicken.** Beginne mit einer offenen Frage im Chat: „Stell dir vor, es ist fertig. Was
machst du, und was siehst du?“ Die eigenen Worte des Owners sind das Wertvollste am Goal. Wenn er nur klickt,
landet er meist auf der ersten Option; ein Goal, das nur aus Klicks entsteht, ist dein Bild und nicht seins.

Danach schließt du mit `AskUserQuestion` nur die Weichen, die seine Erzählung offen lässt:

- Ein bis zwei Fragen je Runde, jede mit einem Satz davor, worum es geht und was davon abhängt.
- Jede Frage ist eine Szene, keine Fachfrage: „Du sagst X, was passiert dann?“
- Zwei bis drei Antworten, deine Empfehlung zuerst; „beides“ oder eine Mischung ist erlaubt.

Wonach du fragst, soweit es das Projekt betrifft und noch offen ist:

- **Hauptweg:** Was ist der eine Weg vom Anfang bis zum Nutzen, der immer gehen muss?
- **Wenn es schiefgeht:** Was sieht er bei einem Fehler oder Abbruch, und wie geht es weiter?
- **Was bleibt:** Was ist nach Schließen und Wiederöffnen noch da?
- **Aussehen:** Gibt es eine Vorlage (Mockup, Bild, Beispielseite), oder schaut er eine erste Fassung selbst an?
- **Grenzen:** Was darf nicht angefasst werden, was gehört ausdrücklich nicht dazu, was entscheidet nur er?

Hör auf, sobald der Hauptweg steht; drei Runden reichen fast immer. Die Liste ist ein Sieb, keine Gliederung: Was
das Projekt nicht betrifft, fällt weg.

Die letzte Frage ist immer dieselbe: **„Liegt dir dazu noch etwas auf dem Herzen?“** Stell sie als normale Frage im
Chat, nicht als Auswahlfrage, und fass davor in wenigen Stichpunkten zusammen, was feststeht. Sagt der Owner „nein“
oder „go“, schreibst du das Goal.

## 3. Das Goal schreiben

Kurz, etwa eine Seite, in der Sprache des Owners. Dieselbe Form für kleine und große Goals; die Größe ändert nur
die Zahl der Szenen.

**Der eigene Zieltext des Owners bleibt wörtlich.** Hat er einen geschrieben oder diktiert, wird er nicht
umformuliert und nicht gekürzt: Er liegt als Datei neben dem Goal und steht unter „Wo die Daten liegen“ als
verbindliche Quelle. Die Szenen machen ihn prüfbar, sie ersetzen ihn nicht.

```markdown
# <Titel als Endzustand>
> Modell: <opus | fable – bei fable ein Satz, warum der Lösungsweg offen ist> · Effort: high (xhigh nur mit
> benannter Fehlerklasse)

## So startest du
<Für den Owner, zwei bis vier Schritte: wo das Terminal aufgeht und die fertige Startzeile zum Einfügen. Darunter
ein Satz, wie sich der Lauf zurücknehmen lässt (Branch und Stand vor dem Start).>

## Kompass
<Zwei, drei Sätze: das Erlebnis, um das es geht, und was im Zweifel gewinnt.>

## Szenen
<Eine bis zwölf Szenen, das Wichtigste zuerst. Jede: „Ich tue X, ich sehe Y.“ mit echten Worten und echten Dingen.
Die Reihenfolge ist die Reihenfolge des Werts: Bricht der Lauf ab, stehen die oberen schon.>

## Grenzen
<Nur was man nicht erraten kann: nicht anfassen, gehört nicht dazu, entscheidet nur der Owner, und entschiedene
Technik, die ein Worker falsch raten würde.>

## Fertig heißt
<Die Szenen laufen im echten Ergebnis (App, Skript, Datei) und sind belegt. Was nur der Owner beurteilen kann
(echte Sprache, Aussehen), steht hier beim Namen; der Worker meldet es als „gebaut, wartet auf den Blick des
Owners“. Dazu: wann der Lauf ehrlich aufhört, wenn etwas nicht geht.>

## Wo die Daten liegen
<Wenige Pfade, jeder in dieser Sitzung geprüft; der Zieltext des Owners zuerst, falls es einen gibt.>
```

**Ein Goal, ein Modell** (Regel im Global-Kern, „Subagents und Effort“; anders nur nach Projektregel). `opus` ist
der Standard: Goals mit bekanntem Weg, etwa Funktionen nach vorhandenem Muster, Umbauten, Tests, Migrationen.
`fable` bekommt ein Goal, wenn der Lösungsweg offen ist, etwa neue Architektur, anspruchsvolle Oberfläche oder
ein Fehler ohne bekannte Ursache; der Grund steht in der Kopfzeile. Passt beides in ein Goal, schneide zwei Goals.

Eine gute Szene: „Ich sage ‚mach den Button rund und etwas größer‘. Noch während ich spreche, wird genau dieser
Button rund und größer; alles andere bleibt, wie es war.“ Ein Zustandssatz wie „Änderungen erscheinen unmittelbar“
darf im Text des Owners stehen; im Goal bekommt er eine solche Szene dazu.

Zeig dem Owner das Goal vollständig im Chat. Nach seinem Okay: im Repo speichern (dort, wo dessen Goals liegen,
sonst fragen), die Worker-Preamble (die des Repos, sonst `~/.claude/skills/xyzgoal/references/worker-preamble.md`)
unter `---` anhängen, pfadbegrenzt committen, mit `spawn-worker` starten. Modell und Effort stehen in der
Kopfzeile des Goals.

## Woran ein Goal scheitert

- Es sagt dem Worker, wie er bauen soll.
- Es besteht aus Zuständen ohne Szene („ist verständlich“, „funktioniert zuverlässig“).
- Es enthält Szenen, die der Owner nie gesehen hat, oder es hat seine eigenen Worte ersetzt.
- Es übernimmt die Gliederung eines früheren Goals statt neu zu fragen.
