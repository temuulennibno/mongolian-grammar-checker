// Service worker: hosts the Hunspell WASM engine and answers spell-check
// requests from content scripts and the popup.
//
// The dictionary (604k entries) takes ~1s to load, so we build it lazily on
// first request and keep it warm. Content scripts hold a long-lived port while
// a field is focused, which prevents the service worker from being torn down
// mid-session.

import { loadModule } from 'hunspell-asm';

const DIC_URL = chrome.runtime.getURL('dict/mn_MN.dic');
const AFF_URL = chrome.runtime.getURL('dict/mn_MN.aff');

let hunspell = null;
let initPromise = null;

// Small LRU-ish cache so repeated words (very common while typing) are free.
const spellCache = new Map();
const suggestCache = new Map();
const MAX_CACHE = 5000;

function remember(map, key, value) {
  if (map.size >= MAX_CACHE) {
    // drop oldest insertion
    map.delete(map.keys().next().value);
  }
  map.set(key, value);
  return value;
}

async function init() {
  if (hunspell) return hunspell;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const factory = await loadModule();
    const [affBuf, dicBuf] = await Promise.all([
      fetch(AFF_URL).then((r) => r.arrayBuffer()),
      fetch(DIC_URL).then((r) => r.arrayBuffer()),
    ]);
    const affPath = factory.mountBuffer(new Uint8Array(affBuf), 'mn_MN.aff');
    const dicPath = factory.mountBuffer(new Uint8Array(dicBuf), 'mn_MN.dic');
    hunspell = factory.create(affPath, dicPath);
    return hunspell;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null; // allow retry on next request
    throw err;
  }
}

function isCorrect(word) {
  if (spellCache.has(word)) return spellCache.get(word);
  const ok = hunspell.spell(word);
  return remember(spellCache, word, ok);
}

function suggestionsFor(word) {
  if (suggestCache.has(word)) return suggestCache.get(word);
  const list = hunspell.suggest(word).slice(0, 8);
  return remember(suggestCache, word, list);
}

// Returns only the misspelled words from the input list (deduped by caller).
async function checkWords(words) {
  await init();
  const wrong = [];
  for (const w of words) {
    if (!isCorrect(w)) wrong.push(w);
  }
  return wrong;
}

async function handle(message) {
  switch (message?.type) {
    case 'check': {
      const wrong = await checkWords(message.words || []);
      return { ok: true, wrong };
    }
    case 'suggest': {
      await init();
      return { ok: true, suggestions: suggestionsFor(message.word) };
    }
    case 'ping': {
      // Warm up the engine without blocking the caller on the heavy load.
      init().catch(() => {});
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown message type' };
  }
}

// One-shot messages (popup, context menu).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});

// Long-lived connections (content scripts). Keeps the worker warm while a user
// is actively editing a field.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'mn-spell') return;
  port.onMessage.addListener((message) => {
    handle(message)
      .then((res) => port.postMessage({ id: message.id, ...res }))
      .catch((err) =>
        port.postMessage({ id: message.id, ok: false, error: String(err) })
      );
  });
});

// Context menu: check the user's current selection on any page.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'mn-check-selection',
    title: 'Монгол алдаа шалгах',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'mn-check-selection' || !info.selectionText) return;
  const words = tokenize(info.selectionText);
  const wrong = await checkWords([...new Set(words)]);
  await chrome.storage.session.set({
    lastSelectionCheck: {
      text: info.selectionText,
      wrong,
      total: words.length,
    },
  });
  if (tab?.id != null) {
    chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
    chrome.action.setBadgeText({ text: wrong.length ? String(wrong.length) : '✓' });
  }
});

// Shared tokenizer (kept in sync with content.js MN_WORD).
function tokenize(text) {
  const matches = text.match(/[А-Яа-яЁёӨөҮү]+/g);
  return matches || [];
}
