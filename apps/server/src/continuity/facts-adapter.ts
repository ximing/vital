import { fixtureFactsAdapter } from './facts-adapter.fixture.js';

export interface ActivityFact {
  field: string;
  value: unknown;
  url: string | null;
  fetchedAt: string;
  validUntil: string | null;
  status: 'verified' | 'unknown';
}

/** Only place, dates, and activity words — never private user memory. */
export interface FactsSearchQuery {
  place: string | null;
  dates: string[];
  activityWords: string[];
}

export interface FactsProposal {
  activityKey: string;
  title: string;
  place: string | null;
  reason: string;
  experience: string;
  timeCost: string;
  moneyRange: string;
  companions: string;
  source: string;
  cancelPolicy: string;
  alternative: string;
  direction: 'familiar' | 'new' | 'low_energy';
  facts: ActivityFact[];
}

export interface FactsAdapter {
  search(query: FactsSearchQuery): Promise<FactsProposal[]>;
  verifyActivity(activityKey: string, when: string, place: string | null): Promise<ActivityFact[]>;
  weather(place: string | null, date: string): Promise<ActivityFact>;
}

let override: FactsAdapter | null = null;

export function getFactsAdapter(): FactsAdapter {
  return override ?? fixtureFactsAdapter;
}

/** Test seam. Pass null to restore the fixture. */
export function setFactsAdapterForTest(adapter: FactsAdapter | null): void {
  override = adapter;
}

export function unknownFact(field: string, at: Date): ActivityFact {
  return {
    field,
    value: null,
    url: null,
    fetchedAt: at.toISOString(),
    validUntil: null,
    status: 'unknown',
  };
}
