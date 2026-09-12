import {
  type LlmCapability,
  type LlmCatalogProvider,
  type LlmProviderPublic,
  type LlmRouting,
  type LlmSettingsPublic,
} from '@vital/dto';
import { Service } from '@rabjs/react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { parseModelParameters } from './ModelParameters';

export type CatalogProvider = LlmCatalogProvider;

export function llmRouteKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

export class LlmSectionService extends Service {
  catalog: CatalogProvider[] = [];
  adding = false;
  error: string | null = null;
  notice: string | null = null;
  testingId: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  get llm(): LlmSettingsPublic {
    return this.auth.user?.llm ?? { providers: [], routing: {} };
  }

  apply(next: LlmSettingsPublic): void {
    const user = this.auth.user;
    if (user) this.auth.setUser({ ...user, llm: next });
  }

  setAdding(value: boolean): void {
    this.adding = value;
  }

  setError(value: string | null): void {
    this.error = value;
  }

  setNotice(value: string | null): void {
    this.notice = value;
  }

  async loadCatalog(): Promise<void> {
    try {
      this.catalog = (await client.llmCatalog()).providers;
    } catch {
      this.catalog = [];
    }
  }

  async saveRoute(capability: LlmCapability, value: string): Promise<void> {
    this.error = null;
    const routing: LlmRouting = { ...this.llm.routing };
    if (value === '') {
      routing[capability] = null;
    } else {
      const [providerId, model] = value.split('::');
      routing[capability] = { providerId: providerId!, model: model! };
    }
    try {
      this.apply(await client.putLlmRouting({ routing }));
      this.notice = t.settings.llm.saved;
    } catch (err) {
      this.error = humanError(err);
    }
  }

  async test(provider: LlmProviderPublic, model = provider.models[0] ?? ''): Promise<void> {
    this.testingId = provider.id;
    this.error = null;
    this.notice = null;
    try {
      await client.testLlmProvider(provider.id, model);
      this.notice = t.settings.llm.testOk;
    } catch (err) {
      this.error = humanError(err);
    } finally {
      this.testingId = null;
    }
  }

  async remove(provider: LlmProviderPublic): Promise<void> {
    this.error = null;
    try {
      this.apply(await client.removeLlmProvider(provider.id));
    } catch (err) {
      this.error = humanError(err);
    }
  }
}

export class AddProviderService extends Service {
  providerId = 'openai';
  label = '';
  baseUrl = '';
  apiKey = '';
  picked: string[] = [];
  parameterDrafts: Record<string, string> = {};

  setProviderId(value: string): void {
    this.providerId = value;
    this.picked = [];
    this.parameterDrafts = {};
  }

  setLabel(value: string): void {
    this.label = value;
  }

  setBaseUrl(value: string): void {
    this.baseUrl = value;
  }

  setApiKey(value: string): void {
    this.apiKey = value;
  }

  setPicked(value: string[]): void {
    this.picked = value;
  }

  setParameterDraft(modelId: string, raw: string): void {
    this.parameterDrafts = { ...this.parameterDrafts, [modelId]: raw };
  }

  async submit(catalog: CatalogProvider[]): Promise<LlmSettingsPublic> {
    const entry = catalog.find((item) => item.id === this.providerId);
    const isCustom = this.providerId === 'custom';
    return client.addLlmProvider({
      providerId: this.providerId,
      label:
        this.label.trim() ||
        (isCustom ? t.settings.llm.customEndpoint : (entry?.name ?? this.providerId)),
      ...(isCustom ? { baseUrl: this.baseUrl.trim() } : {}),
      apiKey: this.apiKey.trim(),
      models: this.picked,
      ...(Object.keys(this.parameterDrafts).length
        ? { modelParameters: parseModelParameters(this.picked, this.parameterDrafts) }
        : {}),
    });
  }
}

export class ProviderParametersService extends Service {
  providerId = '';
  drafts: Record<string, string> = {};
  dirty = false;

  adopt(provider: LlmProviderPublic): void {
    if (this.providerId === provider.id) return;
    this.providerId = provider.id;
    this.drafts = Object.fromEntries(
      provider.models.map((id) => [id, JSON.stringify(provider.modelParameters?.[id] ?? {}, null, 2)]),
    );
    this.dirty = false;
  }

  setDraft(modelId: string, raw: string): void {
    this.drafts = { ...this.drafts, [modelId]: raw };
    this.dirty = true;
  }

  async save(provider: LlmProviderPublic): Promise<LlmSettingsPublic> {
    const next = await client.patchLlmProvider(provider.id, {
      modelParameters: parseModelParameters(provider.models, this.drafts),
    });
    this.dirty = false;
    return next;
  }
}
