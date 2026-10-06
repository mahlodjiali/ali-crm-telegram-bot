# 🤖 Ali's Telegram CRM Bot

Kontaktverwaltung direkt im Telegram - mit automatischer OCR und Airtable-Integration. Emails erstellt Claude.

---

## 📋 Voraussetzungen

1. **Telegram Bot Token** – von @BotFather (hast du schon ✅)
2. **Airtable API Token** – (hast du schon ✅)
3. **Airtable Base ID** – `appsCFsZVpgWRH2Qu` (hast du schon ✅)
4. **Claude API Key** – für OCR von Visitenkarten (musst du noch besorgen ⬇️)

---

## 🚀 Deployment auf Railway (kostenlos + einfach)

### Schritt 1: GitHub Repo erstellen

```bash
git init
git add .
git commit -m "Initial commit"
```

Pushe auf GitHub (neues Repo erstellen auf github.com)

### Schritt 2: Railway verbinden

1. Geh zu https://railway.app
2. Registriere dich (kostenlos)
3. **New Project** → **GitHub Repo**
4. Wähle dein Repo aus
5. Railway deployed automatisch

### Schritt 3: Umgebungsvariablen setzen

In Railway Dashboard:
- **Settings** → **Environment**
- Füge folgende Variablen ein:
  - `TELEGRAM_TOKEN` (hast du)
  - `AIRTABLE_TOKEN` (hast du)
  - `AIRTABLE_BASE_ID` (hast du)
  - `CLAUDE_API_KEY` (musst du noch besorgen)

### Schritt 4: Starten

Railway startet den Bot automatisch nach dem Deploy. Fertig! 🎉

---

## 🔑 Fehlende Credentials besorgen

### Claude API Key
1. Geh zu https://console.anthropic.com/account/keys
2. Melde dich an (oder registriere dich kostenlos)
3. **Create Key**
4. Kopiere den Key
5. **Wichtig:** Trage ihn in Railway unter `CLAUDE_API_KEY` ein

**Kosten:** Claude API ist kostenlos bis ca. 100k Tokens/Tag – für einen Bot mit OCR sollte das locker reichen (~1000 Tokens pro Visitenkarte).



---

## 📱 Verwendung

### Im Telegram:

**Neuen Kontakt erfassen:**
1. Sende eine **Textnachricht** mit Kontaktinfos
   - z.B. "Max Müller, CEO von TechX, max@techx.de, +43 1 2345 6789, www.techx.de"
   - oder nur Teile: "Lisa Schmidt, Firma: GreenEnergy, lisa@greenenergy.at"
2. Claude analysiert die Infos und zeigt erkannte Daten
3. (Optional) Sende ein **Foto einer Visitenkarte** – Claude macht automatisch OCR
4. (Optional) Sende ein **Personen-Foto** – wird mit dem Kontakt gespeichert
5. Schreib `/speichern` → Kontakt wird in Airtable gespeichert

**Visitenkarten-Foto:**
- Nur ein Foto hochladen (keine Nachricht nötig) → Claude macht OCR
- Daten werden angezeigt → `/speichern`

**Follow-up Email Entwurf erstellen:**
1. `/followup [Name]` (z.B. `/followup Max Müller`)
2. Sende eine **Textnachricht** mit deiner Nachricht/Idee
3. Claude generiert einen professionellen Email-Entwurf
4. Entwurf wird in Airtable gespeichert
5. **Später:** Sag Claude Bescheid, dass er die ausstehenden Emails versendet → Claude nutzt Gmail & versendet von `ali@ali.do`

**Abbrechen:**
- `/abbrechen` – setzt den Bot zurück

---

## 🔧 Lokales Testing (optional)

Falls du lokal testen möchtest:

```bash
npm install
cp .env.example .env
# Füge deine Credentials in .env ein
npm start
```

Der Bot läuft dann auf Port 3000.

---

## 📊 Was der Bot kann

✅ **Text-Kontaktinfos verarbeiten** (Claude NLP)
✅ **Visitenkarten per OCR erkennen** (Claude Vision)
✅ **Kontakte in Airtable speichern**
✅ **Fotos zu Kontakten hinzufügen**
✅ **Email-Entwürfe generieren & speichern** (Claude erstellt Profis, Bot speichert in Airtable)
✅ **Intelligente Felderkennung** – extrahiert automatisch Name, Email, Telefon, Firma, etc.

---

## ❓ Troubleshooting

**Bot antwortet nicht?**
- Prüfe die Logs in Railway Dashboard
- Kontrolliere alle Credentials in den Environment Variables

**OCR funktioniert nicht?**
- Claude API Key prüfen
- Credits auf Claude Account vorhanden? (sollte kostenlos sein)
- Ist das Bild groß genug? (mind. 100x100px)

**Text wird nicht korrekt erkannt?**
- Versuche klarere Formatierung: "Max Müller, CEO, max@techx.de"
- Oder sende ein Foto der Visitenkarte statt Text

**Email-Entwürfe werden nicht gespeichert?**
- Ist die "Email Entwürfe" Tabelle in Airtable vorhanden?
- Airtable Token gültig?

**Emails noch nicht versendet?**
- Sag Claude Bescheid: "Versende ausstehende Emails aus Airtable"
- Claude nutzt dann Gmail & versendet alles von ali@ali.do

---

## 📞 Support

Für Probleme: Melde dich bei Claude, gib die Railway Logs durch!

---

**Bot fertig? 🚀 Starte ihn im Telegram mit `/start`**
