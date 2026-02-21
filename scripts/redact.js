'use strict';

const CONTENT_LIMIT = 50000;

/**
 * Strip script/style tags, hidden elements, HTML comments.
 * Truncate to 50K chars. Wrap in [PAGE_CONTENT: ...] delimiters.
 */
function sanitizeWebContent(html) {
  if (!html || typeof html !== 'string') return '';

  let text = html;

  // Remove script and style tags with content
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Remove hidden elements (display:none, visibility:hidden, aria-hidden)
  text = text.replace(/<[^>]+(?:display\s*:\s*none|visibility\s*:\s*hidden|aria-hidden\s*=\s*["']true["'])[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Remove elements with opacity:0 or font-size:0
  text = text.replace(/<[^>]+(?:opacity\s*:\s*0[^0-9]|font-size\s*:\s*0[^0-9])[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Truncate
  if (text.length > CONTENT_LIMIT) {
    text = text.slice(0, CONTENT_LIMIT) + '... [TRUNCATED]';
  }

  // Escape delimiter pattern to prevent injection outside content boundaries
  text = text.replace(/\[PAGE_CONTENT:/g, '[PAGE\u200B_CONTENT:');

  return '[PAGE_CONTENT: ' + text + ']';
}

/**
 * Remove Set-Cookie values, Bearer tokens, session IDs from text.
 */
function redactSecrets(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // Redact Set-Cookie header values
  result = result.replace(/(Set-Cookie:\s*)[^\n;]+/gi, '$1[REDACTED]');

  // Redact Bearer tokens
  result = result.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g, '$1[REDACTED]');

  // Redact common session ID patterns
  result = result.replace(/(session[_-]?id[=:]\s*)[A-Za-z0-9\-._]{8,}/gi, '$1[REDACTED]');
  result = result.replace(/(JSESSIONID[=:]\s*)[A-Za-z0-9\-._]{8,}/gi, '$1[REDACTED]');
  result = result.replace(/(csrf[_-]?token[=:]\s*)[A-Za-z0-9\-._]{8,}/gi, '$1[REDACTED]');

  // Redact Authorization header values
  result = result.replace(/(Authorization:\s*)[^\n]+/gi, '$1[REDACTED]');

  // Redact URL-embedded credentials
  result = result.replace(/(api[_-]?key[=:]\s*)[A-Za-z0-9\-._]{8,}/gi, '$1[REDACTED]');
  result = result.replace(/(access[_-]?token[=:]\s*)[A-Za-z0-9\-._]{8,}/gi, '$1[REDACTED]');
  result = result.replace(/(secret[=:]\s*)[A-Za-z0-9\-._]{8,}/gi, '$1[REDACTED]');
  result = result.replace(/(password[=:]\s*)[^\s&]{4,}/gi, '$1[REDACTED]');
  // Redact basic auth in URLs (user:pass@host)
  result = result.replace(/:\/\/([^:]+):([^@]{4,})@/g, '://[REDACTED]:[REDACTED]@');

  return result;
}

/**
 * Ensure all output goes through both sanitizers.
 * Wraps a data object for JSON output.
 */
function wrapOutput(data) {
  // Deep-walk the object and redact string values
  const sanitized = deepRedact(data);
  return sanitized;
}

function deepRedact(obj) {
  if (typeof obj === 'string') {
    return redactSecrets(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepRedact);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepRedact(value);
    }
    return result;
  }
  return obj;
}

module.exports = { sanitizeWebContent, redactSecrets, wrapOutput };
