import { IncomingMessage, ServerResponse } from "http";
import type {
  AppLoadContext,
  RequestInit as NodeRequestInit,
  Response as NodeResponse,
  ServerBuild,
} from "@remix-run/node";
import {
  AbortController,
  createRequestHandler as createRemixRequestHandler,
  Headers as NodeHeaders,
  Request as NodeRequest,
  writeReadableStreamToWritable,
} from "@remix-run/node";

type FCRequestHeaders = {
  "accept-encoding"?: string;
  connection?: string;
  "keep-alive"?: string;
  "proxy-authorization"?: string;
  te?: string;
  trailer?: string;
  host?: string;
  "x-forwarded-proto"?: string;
  "transfer-encoding"?: string;
};

type FCRequest = IncomingMessage & {
  headers: FCRequestHeaders;
  path: string;
  method: string;
  queries: { [key: string]: string | any[] };
  clientIP: string;
  url: string;
};

type FCResponse = ServerResponse & {
  setStatusCode: (statusCode: number) => FCResponse;
  setHeader: (headerKey: string, headerValue: string) => FCResponse;
  deleteHeader: (headerKey: string) => FCResponse;
  send: (body: any) => FCResponse;
};

/**
 * A function that returns the value to use as `context` in route `loader` and
 * `action` functions.
 *
 * You can think of this as an escape hatch that allows you to pass
 * environment/platform-specific values through to your loader/action.
 */
export type GetLoadContextFunction = (
  req: FCRequest,
  res: FCResponse,
) => AppLoadContext;

export type RequestHandler = (
  req: FCRequest,
  res: FCResponse,
  context: string,
) => Promise<void>;

/**
 * Returns a request handler for Vercel's Node.js runtime that serves the
 * response using Remix.
 */
export function createRequestHandler({
  build,
  getLoadContext,
  mode = process.env.NODE_ENV,
}: {
  build: ServerBuild;
  getLoadContext?: GetLoadContextFunction;
  mode?: string;
}): RequestHandler {
  let handleRequest = createRemixRequestHandler(build, mode);

  return async (req, res) => {
    let request = createRemixRequest(req);
    let loadContext = typeof getLoadContext === "function"
      ? getLoadContext(req, res)
      : undefined;

    let response = (await handleRequest(request, loadContext)) as NodeResponse;

    await sendRemixResponse(res, response);
  };
}

export function createRemixHeaders(
  requestHeaders: FCRequest["headers"],
): NodeHeaders {
  let headers = new NodeHeaders();

  for (let key in requestHeaders) {
    let header = requestHeaders[key]!;
    // set-cookie is an array (maybe others)
    if (Array.isArray(header)) {
      for (let value of header) {
        headers.append(key, value);
      }
    } else {
      headers.append(key, header);
    }
  }

  return headers;
}

export function createRemixRequest(req: FCRequest): NodeRequest {
  let host = req.headers["host"];
  // doesn't seem to be available on their req object!
  let protocol = req.headers["x-forwarded-proto"] || "https";
  let url = new URL(req.url!, `${protocol}://${host}`);

  let controller = new AbortController();

  req.on("close", () => {
    controller.abort();
  });

  let init: NodeRequestInit = {
    method: req.method,
    headers: createRemixHeaders(req.headers),
    signal: controller.signal,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req;
  }

  return new NodeRequest(url.href, init);
}

export async function sendRemixResponse(
  res: FCResponse,
  nodeResponse: NodeResponse,
): Promise<void> {
  res.statusMessage = nodeResponse.statusText;
  let multiValueHeaders = nodeResponse.headers.raw();
  res.writeHead(
    nodeResponse.status,
    nodeResponse.statusText,
    multiValueHeaders,
  );

  if (nodeResponse.body) {
    await writeReadableStreamToWritable(nodeResponse.body, res);
  } else {
    res.end();
  }
}
