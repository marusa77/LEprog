/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";
import { publicConfigurationResponse } from "../app/public-configuration";
import { checkPublicRequest, secureResponse } from "../app/http-security";

interface Env {
  PHRASE_NEST_SUPABASE_URL?: string;
  PHRASE_NEST_SUPABASE_PUBLISHABLE_KEY?: string;
  ASSETS: Fetcher;
  DB: D1Database;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const blocked = checkPublicRequest(request);
    if (blocked) return secureResponse(blocked);
    const url = new URL(request.url);

    if (url.pathname === "/api/public-config") {
      return secureResponse(publicConfigurationResponse(request, {
        PHRASE_NEST_SUPABASE_URL:env.PHRASE_NEST_SUPABASE_URL,
        PHRASE_NEST_SUPABASE_PUBLISHABLE_KEY:env.PHRASE_NEST_SUPABASE_PUBLISHABLE_KEY,
      }));
    }

    return secureResponse(await handler.fetch(request, env, ctx));
  },
};

export default worker;
