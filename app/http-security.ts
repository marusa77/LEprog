const responseHeaders = {
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"strict-origin-when-cross-origin",
  "Permissions-Policy":"camera=(), microphone=(), geolocation=()",
};

export function checkPublicRequest(request: Request): Response | null {
  // Learning writes go directly to authenticated Supabase APIs. This web server
  // has no Server Actions, uploads or image transformation feature to expose.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed",{ status:405,headers:{ Allow:"GET, HEAD" } });
  }
  const { pathname } = new URL(request.url);
  if (pathname === "/_vinext/image" || pathname === "/_next/image") {
    return new Response("Not found",{ status:404 });
  }
  return null;
}

export function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name,value] of Object.entries(responseHeaders)) headers.set(name,value);
  return new Response(response.body,{ status:response.status,statusText:response.statusText,headers });
}
