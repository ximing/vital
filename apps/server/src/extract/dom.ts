import { JSDOM } from 'jsdom';

type DomGlobals = typeof globalThis & {
  DOMParser: typeof DOMParser;
  Node: typeof Node;
  Element: typeof Element;
  HTMLElement: typeof HTMLElement;
  HTMLVideoElement: typeof HTMLVideoElement;
  Document: typeof Document;
  NodeFilter: typeof NodeFilter;
};

let installed = false;
/** Kept alive so the DOMParser realm is not collected. */
let realm: JSDOM | null = null;

/**
 * Article tidy and the shared parser call the global DOMParser.
 * Scripts stay off — Obscura already ran the page.
 */
export function installExtractDom(): void {
  if (installed) return;
  const existing = (globalThis as { DOMParser?: unknown }).DOMParser;
  if (typeof existing === 'function') {
    installed = true;
    return;
  }
  realm = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    contentType: 'text/html',
    url: 'https://extract.invalid/',
  });
  const { window } = realm;
  const g = globalThis as DomGlobals;
  g.DOMParser = window.DOMParser;
  g.Node = window.Node;
  g.Element = window.Element;
  g.HTMLElement = window.HTMLElement;
  g.HTMLVideoElement = window.HTMLVideoElement;
  g.Document = window.Document;
  g.NodeFilter = window.NodeFilter;
  installed = true;
}
