import http from 'node:http';

/** A real loopback HTTP boundary with controlled responses and request recording. */
export async function createFakeApi(respond) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const recorded = {
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    requests.push(recorded);
    try {
      await respond(recorded, response);
    } catch {
      response.destroy();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

export function sendJson(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
