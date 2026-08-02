import http from "node:http";

export async function fetchWithHost(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(input);
  const headers = new Headers(init.headers);
  const body = init.body;
  if (body !== undefined && body !== null && typeof body !== "string") {
    throw new TypeError("test HTTP helper only supports string request bodies");
  }

  return new Promise<Response>((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        resolve(new Response(responseBody.length === 0 ? null : responseBody, {
          status: response.statusCode ?? 500,
          headers: response.headers as HeadersInit,
        }));
      });
    });
    request.once("error", reject);
    if (body !== undefined && body !== null) request.write(body);
    request.end();
  });
}
