import config from './config.js';
import logger from './logger.js';

/**
 * Extract the intended event name from a free-text Slack message.
 *
 * Primary path: Gemini (robust to phrasing — "can we get a form for the DAIS
 * fair next week", "need google form: IIT Bombay techfest", emojis, typos…).
 * Fallback path: a regex, so the flow NEVER breaks if Gemini is unconfigured,
 * rate-limited, or returns something unusable.
 *
 * Returns: { isRequest: boolean, eventName: string|null, source: 'gemini'|'regex'|'none' }
 */

const REQUEST_HINTS =
  /\b(google\s*form|form)\b/i; // message must at least mention a form

// Regex fallback — pulls the phrase after "for" up to "event"/"fair"/end.
function regexExtract(text) {
  if (!text || !REQUEST_HINTS.test(text)) {
    return { isRequest: false, eventName: null, source: 'regex' };
  }
  // "Need a google form for DAIS event" -> "DAIS"
  // "need a form for the DAIS fair" -> "DAIS"
  const patterns = [
    /form\s+for\s+(?:the\s+)?(.+?)\s+(?:event|fair)\b/i,
    /form\s+for\s+(?:the\s+)?(.+?)[.!?\n]*$/i,
    /(?:for|:)\s*(.+?)\s+(?:event|fair)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const name = m[1].replace(/["'`]/g, '').trim();
      if (name && name.length <= 80) {
        return { isRequest: true, eventName: name, source: 'regex' };
      }
    }
  }
  return { isRequest: true, eventName: null, source: 'regex' };
}

async function geminiExtract(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    config.gemini.model
  )}:generateContent?key=${config.gemini.apiKey}`;

  const prompt = `You classify Slack messages from a sales team that requests a Google Form for a school fair/event.

Given the message, decide:
- is_request: true only if the person is asking to create/get/rename a Google Form for a specific fair or event.
- event_name: the clean event name only (e.g. "DAIS", "IIT Bombay Techfest", "GIIS Career Fair"). Strip filler words like "the", "a", "event", "fair", "please". Return null if no request or no clear name.

Message:
"""${text}"""

Respond with ONLY minified JSON: {"is_request": boolean, "event_name": string|null}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(raw);
    return {
      isRequest: !!parsed.is_request,
      eventName: parsed.event_name ? String(parsed.event_name).trim() : null,
      source: 'gemini',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractEventName(text) {
  // Always compute the regex answer — it's our safety net.
  const fallback = regexExtract(text);

  if (!config.ready.gemini) {
    logger.debug('Gemini not configured — using regex fallback');
    return fallback;
  }

  try {
    const g = await geminiExtract(text);
    // If Gemini says it's a request but gives no name, borrow the regex name.
    if (g.isRequest && !g.eventName && fallback.eventName) {
      return { ...g, eventName: fallback.eventName, source: 'gemini+regex' };
    }
    return g;
  } catch (err) {
    logger.warn('Gemini extraction failed — falling back to regex', {
      error: err.message,
    });
    return fallback;
  }
}
