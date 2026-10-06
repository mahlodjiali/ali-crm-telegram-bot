const { Telegraf, session } = require('telegraf');
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
const EMAIL_DRAFTS_TABLE = 'Email Entwürfe';

// Telegram Bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// Session Middleware - speichert User-State
bot.use(session({
  defaultSession: () => ({
    state: null,
    contactData: null,
    photoUrl: null,
    photoData: null,
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
              text: 'Extrahiere folgende Informationen aus dieser Visitenkarte (JSON format): name, rolle, firma, email, telefon, linkedin, website, adresse, stadt. Antworte NUR mit JSON, keine anderen Zeichen.',
            },
          ],
        },
      ],
    });
    
    const content = message.content[0].text;
    return JSON.parse(content);
  } catch (err) {
    console.error('OCR fehlgeschlagen:', err);
    return {};
  }
}

// Extrahiere Daten aus Text
async function parseContactFromText(text) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Extrahiere Kontaktinformationen aus diesem Text und antworte NUR mit JSON (keine anderen Zeichen):
          
"${text}"

Felder: name, rolle, firma, email, telefon, linkedin, website, notizen, stadt, kategorie, tonalitaet.
Gib nur vorhandene Felder zurück. Wenn kein Name vorhanden ist, nutze "Unbekannt".`,
        },
      ],
    });
    
    const content = message.content[0].text;
    return JSON.parse(content);
  } catch (err) {
    console.error('Text-Parsing fehlgeschlagen:', err);
    return { name: 'Unbekannt' };
  }
}

// Merge zwei Kontaktdaten (Foto + Text)
function mergeContactData(photoData, textData) {
  const merged = { ...photoData };
  
  // Überschreibe nur wenn Text-Daten vorhanden und spezifischer sind
  Object.keys(textData).forEach(key => {
    if (textData[key] && (!merged[key] || merged[key] === 'Unbekannt')) {
      merged[key] = textData[key];
    }
  });
  
  return merged;
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
    if (data.adresse) fields.Adresse = data.adresse;
    
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
    console.error('Email-Entwurf speichern fehlgeschlagen:', err.response?.data || err.message);
    return false;
  }
}

// ============ TELEGRAM COMMANDS ============

// Start
bot.command('start', (ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.reply(
    `👋 Willkommen zu Ali's CRM Bot!\n\n` +
    `Sende mir:\n` +
    `📸 Visitenkarten-Foto → OCR extrahiert Daten\n` +
    `📝 Text-Beschreibung → Claude analysiert\n` +
    `📸 + 📝 Beides zusammen → wird kombiniert & gespeichert\n\n` +
    `/followup [Name] → Follow-up Email generieren\n` +
    `/speichern → Speichert aktuelle Daten\n` +
    `/br → Abbrechen`
  );
  ctx.session.state = null;
});

// Foto-Handler (Visitenkarte oder Profilbild)
bot.on('photo', async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    
    const fileUrl = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    
    ctx.reply('⏳ Verarbeite Visitenkarte...');
    const cardData = await extractBusinessCardData(fileUrl);
    
    // Speichere sowohl Daten als auch URL
    ctx.session.photoUrl = fileUrl;
    ctx.session.photoData = cardData;
    ctx.session.state = 'waiting_for_text';
    
    ctx.reply(
      `📋 Visitenkarte erkannt:\n` +
      `Name: ${cardData.name || '—'}\n` +
      `Rolle: ${cardData.rolle || '—'}\n` +
      `Email: ${cardData.email || '—'}\n` +
      `Firma: ${cardData.firma || '—'}\n\n` +
      `Jetzt kannst du:\n` +
      `✏️ Text-Details senden für mehr Infos\n` +
      `oder /speichern um sofort zu speichern`
    );
  } catch (err) {
    console.error('Fehler bei Fotoverarbeitung:', err);
    ctx.reply('❌ Fehler bei der Fotoverarbeitung');
  }
});

// Text-Handler (kann zusätzliche Infos geben oder nach Foto kommen)
bot.on('text', async (ctx) => {
  try {
    if (!ctx.session) ctx.session = {};
    
    // Wenn wir auf Text nach Foto warten
    if (ctx.session.state === 'waiting_for_text' && ctx.session.photoData) {
      ctx.reply('⏳ Analysiere Text + Foto...');
      
      // Parse Text
      const textData = await parseContactFromText(ctx.message.text);
      
      // Merge: Foto + Text
      const mergedData = mergeContactData(ctx.session.photoData, textData);
      ctx.session.contactData = mergedData;
      ctx.session.state = 'ready_save';
      
      ctx.reply(
        `✅ Daten zusammengefasst:\n` +
        `Name: ${mergedData.name}\n` +
        `Rolle: ${mergedData.rolle || '—'}\n` +
        `Email: ${mergedData.email || '—'}\n` +
        `Firma: ${mergedData.firma || '—'}\n\n` +
        `/speichern zum Speichern oder /br um abzubrechen`
      );
      return;
    }
    
    // Wenn kein Foto da ist, analysiere nur Text
    if (!ctx.session.photoData) {
      ctx.reply('⏳ Analysiere Text...');
      
      const contactData = await parseContactFromText(ctx.message.text);
      ctx.session.contactData = contactData;
      ctx.session.state = 'ready_save';
      ctx.session.photoData = contactData;
      
      ctx.reply(
        `📝 Kontakt erkannt:\n` +
        `Name: ${contactData.name}\n` +
        `Rolle: ${contactData.rolle || '—'}\n` +
        `Email: ${contactData.email || '—'}\n` +
        `Firma: ${contactData.firma || '—'}\n\n` +
        `📸 Foto senden (optional) oder /speichern`
      );
      return;
    }
    
    // Fallback
    ctx.reply('Sende eine Visitenkarte, Text oder nutze /start');
  } catch (err) {
    console.error('Fehler bei Text-Verarbeitung:', err);
    ctx.reply('❌ Fehler bei der Verarbeitung');
  }
});

// Speichern
bot.command('speichern', async (ctx) => {
  try {
    if (!ctx.session || !ctx.session.contactData) {
      return ctx.reply('❌ Keine Kontaktdaten vorhanden. Sende zuerst eine Visitenkarte oder Text.');
    }
    
    ctx.reply('⏳ Speichere Kontakt...');
    
    const recordId = await saveContactToAirtable(ctx.session.contactData, ctx.session.photoUrl);
    
    ctx.reply(`✅ Kontakt gespeichert: ${ctx.session.contactData.name}\nID: ${recordId}`);
    
    ctx.session.contactData = null;
    ctx.session.photoUrl = null;
    ctx.session.photoData = null;
    ctx.session.state = null;
  } catch (err) {
    console.error('Fehler beim Speichern:', err);
    ctx.reply(`❌ Fehler beim Speichern: ${err.message}`);
  }
});

// Follow-up Email
bot.command('followup', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1).join(' ');
  
  if (!args) {
    return ctx.reply('Verwendung: /followup [Name]');
  }
  
  try {
    if (!ctx.session) ctx.session = {};
    
    ctx.reply('⏳ Suche Kontakt...');
    
    const contact = await findContactByName(args);
    
    if (!contact) {
      return ctx.reply(`❌ Kontakt "${args}" nicht gefunden`);
    }
    
    ctx.session.followupContact = contact;
    ctx.session.state = 'draft_email';
    
    ctx.reply(
      `📧 Follow-up für: ${contact.fields.Name}\n` +
      `Email: ${contact.fields['E-Mail'] || '—'}\n\n` +
      `Sende eine Nachricht für die Email-Generierung.`
    );
  } catch (err) {
    console.error('Fehler bei Follow-up:', err);
    ctx.reply('❌ Fehler');
  }
});

// Abbrechen (kurz: /br)
bot.command('br', (ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.contactData = null;
  ctx.session.photoUrl = null;
  ctx.session.photoData = null;
  ctx.session.followupContact = null;
  ctx.session.state = null;
  ctx.reply('❌ Abgebrochen');
});

// ============ START BOT ============
bot.launch();
console.log('🤖 Telegram CRM Bot läuft!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
