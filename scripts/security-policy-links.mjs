const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`()\[\]{}*]+/giu;
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?]+$/u;

export function containsExactHttpUrl(markdown, expectedUrl) {
  if (typeof markdown !== 'string') {
    throw new TypeError('Markdown content must be a string.');
  }

  const expected = parseHttpUrl(expectedUrl);
  if (!expected) {
    throw new TypeError('Expected URL must be an absolute HTTP or HTTPS URL.');
  }

  for (const match of markdown.matchAll(HTTP_URL_PATTERN)) {
    const candidateText = match[0].replace(TRAILING_PUNCTUATION_PATTERN, '');
    const candidate = parseHttpUrl(candidateText);
    if (candidate && urlsAreEqual(candidate, expected)) {
      return true;
    }
  }

  return false;
}

function parseHttpUrl(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function urlsAreEqual(actual, expected) {
  return actual.protocol === expected.protocol &&
    actual.username === expected.username &&
    actual.password === expected.password &&
    actual.hostname === expected.hostname &&
    actual.port === expected.port &&
    actual.pathname === expected.pathname &&
    actual.search === expected.search &&
    actual.hash === expected.hash;
}
