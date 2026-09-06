import { REPORT_TEMPLATES, type ReportType } from './reportTemplates.js';

const H2 = /^## /;

export function notesHeadingFor(type: ReportType): string {
  return `## ${REPORT_TEMPLATES[type].notesHeading}`;
}

/** Body after the notes H2, excluding a following H2 section. */
export function extractNotes(bodyMd: string, type: ReportType): string {
  const heading = notesHeadingFor(type);
  const idx = bodyMd.indexOf(heading);
  if (idx < 0) return '';
  let rest = bodyMd.slice(idx + heading.length);
  if (rest.startsWith('\n')) rest = rest.slice(1);
  const lines = rest.split('\n');
  const cut = lines.findIndex((line, i) => i > 0 && H2.test(line));
  const kept = cut >= 0 ? lines.slice(0, cut) : lines;
  return kept.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

export function hasWrote(bodyMd: string, type: ReportType): boolean {
  return extractNotes(bodyMd, type).trim().length > 0;
}

export function replaceNotes(bodyMd: string, type: ReportType, notes: string): string {
  const heading = notesHeadingFor(type);
  const trimmed = notes.replace(/\n+$/, '');
  const block = trimmed.length === 0 ? `${heading}\n` : `${heading}\n\n${trimmed}\n`;
  const idx = bodyMd.indexOf(heading);
  if (idx < 0) {
    const base = bodyMd.replace(/\n+$/, '');
    return `${base}\n\n${block}`;
  }
  const afterHeading = bodyMd.slice(idx + heading.length);
  const afterLines = afterHeading.startsWith('\n') ? afterHeading.slice(1) : afterHeading;
  const lines = afterLines.split('\n');
  const cut = lines.findIndex((line, i) => i > 0 && H2.test(line));
  const tail = cut >= 0 ? `\n${lines.slice(cut).join('\n')}` : '';
  return `${bodyMd.slice(0, idx)}${block}${tail.replace(/^\n\n/, '\n')}`;
}
