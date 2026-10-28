export type PublicConfiguration = { projectUrl: string; publishableKey: string; requireAccess?: boolean };

export function isPublicApiKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const encoded = value.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(encoded)).role === "anon";
  } catch { return false; }
}

export function parsePublicConfiguration(value: unknown): PublicConfiguration | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const projectUrl = typeof row.projectUrl === "string" ? row.projectUrl.trim().replace(/\/$/, "") : "";
  const publishableKey = typeof row.publishableKey === "string" ? row.publishableKey.trim() : "";
  // New managed deployments accept only explicitly publishable keys, never JWTs
  // whose role could be service_role. Legacy manual settings remain separate.
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) return null;
  return { projectUrl, publishableKey, requireAccess:row.requireAccess !== false };
}

export function publicConfigurationResponse(request: Request, values: Record<string, unknown>): Response {
  const headers = { "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" };
  if (request.method !== "GET") return Response.json({ error:"Method not allowed" }, { status:405, headers:{ ...headers, Allow:"GET" } });
  const config = parsePublicConfiguration({ projectUrl:values.PHRASE_NEST_SUPABASE_URL, publishableKey:values.PHRASE_NEST_SUPABASE_PUBLISHABLE_KEY, requireAccess:true });
  // Never serialize the environment: it may contain translation or admin keys.
  return Response.json(config || { configured:false }, { headers });
}
