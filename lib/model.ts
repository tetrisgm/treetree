/** The single seam between the archivist and its language model.
 *
 * Every route that talks to a model constructs its client and picks its
 * model name here, so supporting another provider (docs/PLATFORM.md phase 7)
 * is a change to this file plus an adapter - not a hunt through routes.
 * Today the provider is OpenAI's Responses API; the deployer brings
 * OPENAI_API_KEY and optionally OPENAI_MODEL.
 */

import OpenAI from "openai";
import { anthropicResponsesClient, DEFAULT_ANTHROPIC_MODEL } from "./model-anthropic";

export const DEFAULT_MODEL = "gpt-5.4";

/** Whichever provider the deployer has a key for. MODEL_PROVIDER settles it
 * when both are present; otherwise the key that exists wins, so a deployer
 * who brings only ANTHROPIC_API_KEY needs no further configuration. */
export function modelProvider(): "openai" | "anthropic" {
  const declared = (process.env.MODEL_PROVIDER || "").toLowerCase();
  if (declared === "anthropic" || declared === "openai") return declared;
  if (!process.env.OPENAI_API_KEY && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "openai";
}

export function modelName(): string {
  return modelProvider() === "anthropic"
    ? process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL
    : process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function modelConfigured(): boolean {
  return Boolean(modelProvider() === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
}

/** Throws when unconfigured - callers gate with modelConfigured() first and
 * return their route's 503. Both providers present the same small surface:
 * `.responses.create(request)` with an OpenAI-shaped request and reply. */
export function modelClient(): Pick<OpenAI, "responses"> | ReturnType<typeof anthropicResponsesClient> {
  if (modelProvider() === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("model_not_configured");
    return anthropicResponsesClient(apiKey, modelName());
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("model_not_configured");
  return new OpenAI({ apiKey });
}
