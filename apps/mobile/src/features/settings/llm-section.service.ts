import { Service } from '@rabjs/react';
import type {
  LlmCapability,
  LlmCatalogProvider,
  LlmRouting,
  LlmSettingsPublic,
} from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import { parseRouteKey, routeKey } from './llm';

export class LlmSectionService extends Service {
  catalog: LlmCatalogProvider[] = [];
  adding = false;
  routingFor: LlmCapability | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get llm(): LlmSettingsPublic {
    return this.auth.user?.llm ?? { providers: [], routing: {} };
  }

  get modelOptions(): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];
    for (const provider of this.llm.providers) {
      for (const model of provider.models) {
        options.push({
          value: routeKey(provider.id, model),
          label: `${model} · ${provider.label}`,
        });
      }
    }
    return options;
  }

  get routingTarget(): string {
    const capability = this.routingFor;
    if (!capability) return '';
    const route = this.llm.routing[capability];
    return route ? routeKey(route.providerId, route.model) : '';
  }

  async loadCatalog(): Promise<void> {
    try {
      const res = await client.llmCatalog();
      this.catalog = res.providers;
    } catch {
      this.catalog = [];
    }
  }

  apply(next: LlmSettingsPublic): void {
    const user = this.auth.user;
    if (!user) return;
    this.auth.refreshUser({ ...user, llm: next });
  }

  openAdd(): void {
    this.adding = true;
  }

  finishAdd(next: LlmSettingsPublic): void {
    this.apply(next);
    this.adding = false;
    toast(copy.settings.llm.saved);
  }

  openRouting(capability: LlmCapability): void {
    this.routingFor = capability;
  }

  closeRouting(): void {
    this.routingFor = null;
  }

  pickRoute(value: string): void {
    const capability = this.routingFor;
    this.routingFor = null;
    if (capability) void this.setRoute(capability, value);
  }

  async setRoute(capability: LlmCapability, value: string): Promise<void> {
    const routing: LlmRouting = { ...this.llm.routing };
    if (value === '') {
      routing[capability] = null;
    } else {
      const parsed = parseRouteKey(value);
      if (!parsed) return;
      routing[capability] = parsed;
    }
    try {
      this.apply(await client.putLlmRouting({ routing }));
      toast(copy.settings.llm.saved);
    } catch (err) {
      toast(humanError(err));
    }
  }
}
