import type { PedagogicalAnalyticsState } from '../types';

export function defaultPedagogicalState(): PedagogicalAnalyticsState {
  return {
    v: 1,
    step: 'draft',
    job: { status: 'idle', done: 0, total: 0, error: null },
    segments: [],
    notification: { emailEnabled: true, maxWebhookUrl: '', consent: false },
    excelProjectId: null,
    sourceBlocks: null,
    piiMap: {},
    redactedSource: '',
    sourcePlain: '',
    piiEntitiesDraft: [],
    llmLast: null,
    piiAuto: null,
  };
}
