const { Telegraf, session } = require('telegraf');
const Airtable = require('airtable');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

// ============ KONFIGURATION ============
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// Claude Client
const anthropic = new Anthropic({ apiKey: CLAUDE_API_KEY });

// Airtable REST API Setup (via axios - zuverlässiger mit PATs)
const AIRTABLE_API_URL = 'https://api.airtable.com/v0';
const airtableHeaders = {
  'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
  'Content-Type': 'application/json'
};

const PERSONEN_TABLE = 'Personen';
const EMAIL_DRAFTS_TABLE = 'Email Entwürfe'; // Neue Tabelle für Entwürfe

// Telegram Bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// Session Middleware - speichert User-State
bot.use(session({
  defaultSession: () => ({
    state: null,
    contactData: null,
    photoUrl: null,
    followupContact: null,
    emailDraft: null,
  })
}));

// ============ HILFSFUNKTIONEN ============

// OCR für Visitenkarte via Claude Vision
async function extractBusinessCardData(imageUrl) {
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data).toString('base64');
    
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: 'Extrahiere Kontaktinformationen aus dieser Visitenkarte und antworte NUR mit JSON (keine anderen Zeichen). Format: {name, rolle, firma, email, telefon, linkedin, website}. Nur vorhandene Felder einschließen.',
            },
          ],
        },
      ],
    });
    
    const content = message.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (err) {
    console.error('OCR fehlgeschlagen:', err);
    return {};
  }
}

// Lade Foto zu Airtable und gib URL zurück
async function uploadPhotoToAirtable(fileUrl, fileName) {
  try {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data).toString('base64');
    
    // Speichere als Datei-Referenz (wird in Airtable eingebunden)
    return {
      url: fileUrl,
      filename: fileName || 'photo.jpg',
    };
  } catch (err) {
    console.error('Foto-Upload fehlgeschlagen:', err);
    return null;
  }
}

// Erweitere Airtable-Struktur dynamisch
async function ensureFieldExists(fieldName, fieldType = 'singleLineText') {
  try {
    const schema = await base(PERSONEN_TABLE).describe();
    const fieldExists = schema.fields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
    
    if (!fieldExists) {
      console.log(`Erstelle neues Feld: ${fieldName}`);
      // Hinweis: Airtable API erlaubt keine direkten Schema-Änderungen über REST
      // Daher: Erstelle ein generisches "Weitere Infos" Feld, wenn nicht vorhanden
      const customField = schema.fields.find(f => f.name === 'Notizen' || f.name === 'custom_fields');
      if (!customField) {
        console.log(`Warnung: ${fieldName} kann nicht hinzugefügt werden - nutze Notizen-Feld stattdessen`);
      }
      return 'Notizen'; // Fallback
    }
    return fieldName;
  } catch (err) {
    console.error('Schema-Abfrage fehlgeschlagen:', err);
    return 'Notizen';
  }
}

// Extrahiere Daten aus Text
async function parseContactFromText(text) {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Extrahiere Kontaktinformationen aus diesem Text und antworte NUR mit JSON (keine anderen Zeichen):
        "${text}"
        
        Felder: name (required), rolle, firma, email, telefon, linkedin, website, notizen, stadt, kategorie, tonalitaet.
        Format: {name, rolle, firma, ...}
        Nur vorhandene Felder einschließen.`,
      },
    ],
  });
  
  const content = message.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : { name: 'Unbekannt' };
}

// Speichere Kontakt in Airtable via REST API
async function saveContactToAirtable(data, photoUrl = null) {
  try {
    const fields = {
      Name: data.name || 'Unbekannt',
    };
    
    if (data.rolle) fields.Rolle = data.rolle;
    if (data.firma) fields.Firma = data.firma;
    if (data.email) fields['E-Mail'] = data.email;
    if (data.telefon) fields.Telefon = data.telefon;
    if (data.linkedin) fields.LinkedIn = data.linkedin;
    if (data.website) fields.Website = data.website;
    if (data.notizen) fields.Notizen = data.notizen;
    if (data.stadt) fields.Stadt = data.stadt;
    if (data.kategorie) fields.Kategorie = data.kategorie;
    if (data.tonalitaet) fields.Tonalität = data.tonalitaet;
    
    if (photoUrl) {
      fields.Foto = [{ url: photoUrl }];
    }
    
    const response = await axios.post(
      `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${PERSONEN_TABLE}`,
      { records: [{ fields }] },
      { headers: airtableHeaders }
    );
    
    return response.data.records[0].id;
  } catch (err) {
    console.error('Fehler beim Speichern in Airtable:', err.response?.data || err.message);
    throw err;
  }
}

// Finde Kontakt in Airtable via REST API
async function findContactByName(name) {
  try {
    const filterFormula = `SEARCH(LOWER("${name.toLowerCase()}"), LOWER({Name}))`;
    const response = await axios.get(
      `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${PERSONEN_TABLE}?filterByFormula=${encodeURIComponent(filterFormula)}`,
      { headers: airtableHeaders }
    );
    
    return response.data.records.length > 0 ? response.data.records[0] : null;
  } catch (err) {
    console.error('Kontaktsuche fehlgeschlagen:', err.response?.data || err.message);
    return null;
  }
}

// Speichere Email-Entwurf in Airtable via REST API
async function saveEmailDraft(contactName, contactEmail, subject, body) {
  try {
    await axios.post(
      `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${encodeURIComponent(EMAIL_DRAFTS_TABLE)}`,
      {
        records: [{
          fields: {
            'Empfänger': contactName,
            'Email': contactEmail,
            'Betreff': subject,
            'Entwurf': body,
            'Status': 'Entwurf',
            'Erstellt': new Date().toISOString(),
          }
        }]
      },
      { headers: airtableHeaders }
    );
    return true;
  } catch (err) {
    console.error('Fehler beim Speichern des Email-Entwurfs:', err);
    return false;
  }
}

// ============ TELEGRAM COMMANDS ============

// Start
bot.command('start', (ctx) => {
  // Initialisiere Session wenn nötig
  if (!ctx.session) {
    ctx.session = {
      state: null,
      contactData: null,
      photoUrl: null,
      followupContact: null,
      emailDraft: null,
    };
  }
  
  ctx.reply(
    `👋 Willkommen zu Ali's CRM Bot!\n\n` +
    `Sende mir:\n` +
    `📝 Text → Kontaktinfo eintragen (z.B. "Max Müller, CEO von TechX, max@techx.de")\n` +
    `📷 Visitenkarten-Foto → Claude OCR extrahiert Daten\n` +
    `👤 Personen-Foto → Wird zum Kontakt gespeichert\n\n` +
    `/followup [Name] → Follow-up Email senden`
  );
  ctx.session.state = null;
});

// Foto
bot.on('photo', async (ctx) => {
  // Stelle sicher dass session existiert
  if (!ctx.session) {
    ctx.session = {
      state: null,
      contactData: null,
      photoUrl: null,
      followupContact: null,
      emailDraft: null,
    };
  }
  
  try {
    const fileUrl = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    
    // Versuche OCR für Visitenkarte
    ctx.reply('⏳ Verarbeite Foto...');
    const cardData = await extractBusinessCardData(fileUrl);
    
    if (cardData && Object.keys(cardData).length > 0) {
      ctx.session.contactData = cardData;
      ctx.session.photoUrl = fileUrl;
      ctx.session.state = 'ready_save';
      
      ctx.reply(
        `📇 Visitenkarte erkannt:\n` +
        `Name: ${cardData.name || '—'}\n` +
        `Rolle: ${cardData.rolle || '—'}\n` +
        `Email: ${cardData.email || '—'}\n` +
        `Firma: ${cardData.firma || '—'}\n\n` +
        `/speichern um zu speichern`
      );
    } else if (ctx.session.contactData) {
      // Speichere Foto zum bestehenden Kontakt
      ctx.session.photoUrl = fileUrl;
      ctx.reply('✅ Foto hinzugefügt. /speichern zum Speichern');
    } else {
      ctx.reply('❌ Keine Visitenkarte erkannt. Spreche die Daten auf oder versuche ein anderes Foto.');
    }
  } catch (err) {
    console.error('Fehler bei Fotoverarbeitung:', err);
    ctx.reply('❌ Fehler bei der Fotoverarbeitung');
  }
});

// Speichern
bot.command('speichern', async (ctx) => {
  try {
    if (!ctx.session || !ctx.session.contactData) {
      return ctx.reply('❌ Keine Kontaktdaten vorhanden. Sende zuerst eine Textnachricht oder Visitenkarte.');
    }
    
    ctx.reply('⏳ Speichere Kontakt...');
    
    const recordId = await saveContactToAirtable(ctx.session.contactData, ctx.session.photoUrl);
    
    ctx.reply(`✅ Kontakt gespeichert: ${ctx.session.contactData.name}\nID: ${recordId}`);
    
    ctx.session.contactData = null;
    ctx.session.photoUrl = null;
    ctx.session.state = null;
  } catch (err) {
    console.error('Fehler beim Speichern:', err);
    ctx.reply(`❌ Fehler beim Speichern: ${err.message}`);
  }
});

// Follow-up Email Entwurf
bot.command('followup', async (ctx) => {
  // Stelle sicher dass session existiert
  if (!ctx.session) {
    ctx.session = {
      state: null,
      contactData: null,
      photoUrl: null,
      followupContact: null,
      emailDraft: null,
    };
  }
  
  const args = ctx.message.text.split(' ').slice(1).join(' ');
  
  if (!args) {
    return ctx.reply('Verwendung: /followup [Name]');
  }
  
  try {
    ctx.reply('⏳ Suche Kontakt...');
    
    const contact = await findContactByName(args);
    
    if (!contact) {
      return ctx.reply(`❌ Kontakt "${args}" nicht gefunden`);
    }
    
    if (!contact.fields['E-Mail']) {
      return ctx.reply(`❌ Keine Email-Adresse für ${contact.fields.Name} gespeichert`);
    }
    
    ctx.session.followupContact = contact;
    ctx.session.state = 'draft_email';
    ctx.session.emailDraft = {
      name: contact.fields.Name,
      email: contact.fields['E-Mail'],
    };
    
    ctx.reply(
      `📧 Follow-up für: ${contact.fields.Name}\n` +
      `Email: ${contact.fields['E-Mail']}\n\n` +
      `Schreibe deine Nachricht (wird als Entwurf gespeichert):`
    );
  } catch (err) {
    console.error('Fehler bei Follow-up:', err);
    ctx.reply('❌ Fehler');
  }
});

// Abbrechen
bot.command('abbrechen', (ctx) => {
  if (ctx.session) {
    ctx.session.contactData = null;
    ctx.session.photoUrl = null;
    ctx.session.followupContact = null;
    ctx.session.state = null;
  }
  ctx.reply('✅ Zurückgesetzt');
});

// Text-Input für Kontakte oder Email-Entwürfe
bot.on('text', async (ctx) => {
  // Ignoriere Commands
  if (ctx.message.text.startsWith('/')) {
    return;
  }
  
  // Stelle sicher dass session existiert
  if (!ctx.session) {
    ctx.session = {
      state: null,
      contactData: null,
      photoUrl: null,
      followupContact: null,
      emailDraft: null,
    };
  }
  
  try {
    // Email-Entwurf Mode
    if (ctx.session.state === 'draft_email' && ctx.session.emailDraft) {
      const emailDraft = ctx.session.emailDraft;
      
      // Generiere Betreff + formale Email
      const emailResponse = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Du bist Ali Mahlodji (CEO futureOne GmbH). Generiere eine professionelle Follow-up Email. Input: "${ctx.message.text}"
            
            Antworte NUR mit JSON format:
            {
              "betreff": "Email Betreff",
              "body": "vollständiger Email Body (HTML formatted)"
            }`,
          },
        ],
      });
      
      const emailContent = emailResponse.content[0].text;
      const jsonMatch = emailContent.match(/\{[\s\S]*\}/);
      const emailData = jsonMatch ? JSON.parse(jsonMatch[0]) : { betreff: 'Follow-up', body: ctx.message.text };
      
      // Speichere als Entwurf in Airtable
      await saveEmailDraft(emailDraft.name, emailDraft.email, emailData.betreff, emailData.body);
      
      ctx.reply(
        `✅ Email-Entwurf gespeichert!\n\n` +
        `📧 Empfänger: ${emailDraft.email}\n` +
        `Betreff: ${emailData.betreff}\n\n` +
        `Der Entwurf wurde in Airtable gespeichert. Claude versendet ihn später.`
      );
      
      ctx.session.followupContact = null;
      ctx.session.emailDraft = null;
      ctx.session.state = null;
      return;
    }
    
    // Normaler Kontakt-Eingabe Mode
    ctx.reply('⏳ Verarbeite Kontaktinfo...');
    
    // Parse Kontaktdaten aus Text
    const contactData = await parseContactFromText(ctx.message.text);
    ctx.session.contactData = contactData;
    ctx.session.state = 'pending_photo';
    
    ctx.reply(
      `✅ Kontakt erkannt:\n` +
      `Name: ${contactData.name}\n` +
      `Rolle: ${contactData.rolle || '—'}\n` +
      `Email: ${contactData.email || '—'}\n` +
      `Telefon: ${contactData.telefon || '—'}\n` +
      `Firma: ${contactData.firma || '—'}\n\n` +
      `Foto? (optional) Oder /speichern`
    );
  } catch (err) {
    console.error('Fehler bei Text-Verarbeitung:', err);
    ctx.reply('❌ Fehler bei der Verarbeitung');
  }
});

// ============ START BOT ============
bot.launch();
console.log('🤖 Telegram CRM Bot läuft!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
