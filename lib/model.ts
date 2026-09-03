/** The single seam between the archivist and its language model.
 *
 * Every route that talks to a model constructs its client and picks its
 * model name here, so supporting another provider (docs/PLATFORM.md phase 7)
 * is a change to this file plus an adapter - not a hunt through routes.
 * Today the provider is OpenAI's Responses API; the deployer brings
 * OPENAI_API_KEY and optionally OPENAI_MODEL.
 */

import OpenAI from "openai";

export const DEFAULT_MODEL = "gpt-5.4";

export function modelName(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function modelConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Throws when unconfigured - callers gate with modelConfigured() first and
 * return their route's 503. */
export function modelClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("model_not_configured");
  return new OpenAI({ apiKey });
}
