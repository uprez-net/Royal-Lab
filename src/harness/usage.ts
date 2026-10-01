import type { Limits } from '#contracts/common';
import type { LanguageModelUsage } from 'ai';
export interface Pricing {
  version: string;
  asOf: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number | undefined;
}
export class BudgetError extends Error {}
export const knownTokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export class Usage {
  inputTokens: number | null = 0;
  outputTokens: number | null = 0;
  costUsd: number | null = 0;
  turns = 0;
  toolAttempts = 0;
  requestsStarted = 0;
  responsesReceived = 0;
  readonly started = Date.now();
  constructor(
    readonly limits: z.infer<typeof Limits>,
    readonly pricing?: Pricing,
  ) {}
  beforeRequest(reservedOutput: number) {
    if (
      Date.now() - this.started >= this.limits.maxDurationMs ||
      this.turns >= this.limits.maxTurns
    )
      throw new BudgetError('Turn/time budget exhausted');
    if (this.inputTokens === null || this.outputTokens === null || this.costUsd === null)
      throw new Error('USAGE_UNVERIFIED: cannot authorize another paid request');
    if (
      this.inputTokens >= this.limits.maxInputTokens ||
      this.outputTokens + reservedOutput > this.limits.maxOutputTokens
    )
      throw new BudgetError('Token budget exhausted');
    const inputReservation = this.limits.maxInputTokens - this.inputTokens;
    const outputReservation = this.limits.maxOutputTokens - this.outputTokens;
    if (
      this.pricing &&
      this.costUsd +
        (inputReservation * this.pricing.inputUsdPerMillion +
          outputReservation * this.pricing.outputUsdPerMillion) /
          1_000_000 >
        this.limits.maxCostUsd
    )
      throw new BudgetError('Cost ceiling cannot cover the remaining declared token reservation');
    this.turns++;
  }
  add(usage: LanguageModelUsage) {
    this.responsesReceived++;
    const input = knownTokens(usage.inputTokens);
    const output = knownTokens(usage.outputTokens);
    this.inputTokens =
      input === null || this.inputTokens === null ? null : this.inputTokens + input;
    this.outputTokens =
      output === null || this.outputTokens === null ? null : this.outputTokens + output;
    const cached = knownTokens(usage.inputTokenDetails?.cacheReadTokens ?? 0);
    if (!this.pricing || input === null || output === null || cached === null || cached > input)
      this.costUsd = null;
    else if (this.costUsd !== null) {
      const rate = this.pricing.cachedInputUsdPerMillion ?? this.pricing.inputUsdPerMillion;
      this.costUsd +=
        ((input - cached) * this.pricing.inputUsdPerMillion +
          cached * rate +
          output * this.pricing.outputUsdPerMillion) /
        1_000_000;
    }
  }
  reconcileUnansweredRequests() {
    if (this.requestsStarted > this.responsesReceived) {
      this.inputTokens = null;
      this.outputTokens = null;
      this.costUsd = null;
    }
  }
  check() {
    if (
      (this.inputTokens ?? 0) > this.limits.maxInputTokens ||
      (this.outputTokens ?? 0) > this.limits.maxOutputTokens ||
      (this.costUsd ?? 0) > this.limits.maxCostUsd ||
      Date.now() - this.started >= this.limits.maxDurationMs
    )
      throw new BudgetError('Candidate resource budget exhausted');
  }
}
import type { z } from 'zod';
