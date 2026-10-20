/**
 * Decide whether a headline or suggestion is worth showing as a proposal.
 * Production rejects were nightly restatements: calendar logistics, 「仍未启动」,
 * 「待定义」, and the same sentence with a new date or a 今日 a/b count.
 */

const FILLER =
  /待定义|仍未启动|均未完成|均未处理|均未解决|均未启动|均未打卡|无新动态|处于待处理|处于待定义/;
const CALENDAR_ADVICE = /订会议室|同步议程|参会人|会议邀请/;
const FRACTION = /\d+\s*[/／]\s*\d+/;

export function asTime(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Compare clocks. A wording pass is due only after a real task change. */
export function shouldRefreshWording(input: {
  agentUpdatedAt: Date | null;
  lastFeedbackAt: Date | null;
  latestFactAt: Date | null;
}): boolean {
  const quietCandidates = [input.agentUpdatedAt, input.lastFeedbackAt].filter(
    (value): value is Date => value !== null,
  );
  if (quietCandidates.length === 0) return true;
  const quietAt = quietCandidates.reduce((latest, value) => (value > latest ? value : latest));
  if (!input.latestFactAt) return false;
  return input.latestFactAt.getTime() > quietAt.getTime();
}

/** Drop the thread name, dates, and counts so a rephrase of the same fact matches. */
export function wordingKey(text: string, threadName: string): string {
  let key = text.trim().toLowerCase();
  const name = threadName.trim().toLowerCase();
  if (name !== '') key = key.split(name).join('');
  return key
    .replace(/【[^】]*】/g, '')
    .replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, '')
    .replace(/\d{1,2}[./-]\d{1,2}/g, '')
    .replace(FRACTION, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Status filler, meeting logistics, or a daily count the board already shows. */
export function isStaleWording(text: string, milestoneTotal = 0): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (FILLER.test(trimmed) || CALENDAR_ADVICE.test(trimmed)) return true;
  return milestoneTotal <= 0 && FRACTION.test(trimmed);
}

export interface WordingPlan {
  /** Null keeps the stored sentence. Empty string clears it. */
  headline: string | null;
  proposeHeadline: boolean;
  suggestion: string | null;
  proposeSuggestion: boolean;
}

export function planWordingUpdate(input: {
  threadName: string;
  currentHeadline: string | null;
  currentSuggestion: string | null;
  ruleNextStep: string | null;
  nextHeadline: string;
  nextSuggestion: string;
  milestoneTotal: number;
}): WordingPlan {
  const threadName = input.threadName;
  const currentHeadline = input.currentHeadline?.trim() ?? '';
  const currentSuggestion = input.currentSuggestion?.trim() ?? '';
  const nextHeadline = input.nextHeadline.trim();
  const nextSuggestion = input.nextSuggestion.trim();
  const ruleNextStep = input.ruleNextStep?.trim() ?? '';
  const nextHeadlineKey = wordingKey(nextHeadline, threadName);
  const sameHeadline =
    nextHeadlineKey === '' || nextHeadlineKey === wordingKey(currentHeadline, threadName);
  const headlineUseful = !sameHeadline && !isStaleWording(nextHeadline, input.milestoneTotal);
  const clearHeadline =
    currentHeadline !== '' &&
    (wordingKey(currentHeadline, threadName) === '' ||
      isStaleWording(currentHeadline, input.milestoneTotal));

  const nextHeadlineStale = nextHeadlineKey === '' || isStaleWording(nextHeadline, input.milestoneTotal);
  const nextSuggestionKey = wordingKey(nextSuggestion, threadName);
  const sameSuggestion =
    nextSuggestion === '' ||
    nextSuggestionKey === '' ||
    nextSuggestionKey === wordingKey(currentSuggestion, threadName) ||
    (ruleNextStep !== '' && nextSuggestionKey === wordingKey(ruleNextStep, threadName));
  // A filler status and its advice are one nag. A repeated good status can still carry a new step.
  const suggestionUseful =
    !nextHeadlineStale && !sameSuggestion && !isStaleWording(nextSuggestion, 0);
  const clearSuggestion = currentSuggestion !== '' && isStaleWording(currentSuggestion, 0);

  return {
    headline: headlineUseful ? nextHeadline : clearHeadline ? '' : null,
    proposeHeadline: headlineUseful,
    suggestion: suggestionUseful ? nextSuggestion : clearSuggestion ? '' : null,
    proposeSuggestion: suggestionUseful,
  };
}
