import type { ImageQuality } from "@/lib/edit-core/project-settings-store";

export interface GenerateImageParams {
  apiKey: string;
  model: string;
  prompt: string;
  quality: ImageQuality;
  /** OpenAI image size, e.g. "1536x1024" (16:9), "1024x1024", "1024x1536". */
  size?: string;
}

export interface GenerateImageResult {
  b64: string;
}

type NodeRequire = (moduleName: string) => unknown;

interface IncomingMessageLike {
  statusCode?: number;
  setEncoding: (encoding: string) => void;
  on: (event: string, callback: (chunk: string) => void) => void;
}

interface ClientRequestLike {
  on: (event: string, callback: (error: Error) => void) => void;
  write: (data: string) => void;
  end: () => void;
}

interface HttpsModule {
  request: (options: unknown, callback: (res: IncomingMessageLike) => void) => ClientRequestLike;
}

interface BufferModule {
  Buffer: { byteLength: (input: string, encoding?: string) => number };
}

/**
 * Generates one image with OpenAI's images API (gpt-image-1) using the Node `https` module so
 * the request is not subject to CEP/browser CORS. Returns the base64-encoded PNG payload.
 * gpt-image-1 always responds with `b64_json` (no URL), so we read that directly.
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  if (!params.apiKey) {
    throw new Error("OpenAI API key is not set.");
  }
  if (typeof window.require !== "function") {
    throw new Error("Image generation requires the Premiere (Node-enabled) panel.");
  }

  const nodeRequire = window.require as NodeRequire;
  const https = nodeRequire("https") as HttpsModule;
  const { Buffer } = nodeRequire("buffer") as BufferModule;

  const body = JSON.stringify({
    model: params.model || "gpt-image-1",
    prompt: params.prompt,
    n: 1,
    size: params.size || "1536x1024",
    quality: params.quality || "low",
  });

  return new Promise<GenerateImageResult>((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        hostname: "api.openai.com",
        path: "/v1/images/generations",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsed: {
            data?: Array<{ b64_json?: string }>;
            error?: { message?: string };
          };
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            reject(new Error(`Failed to parse OpenAI response: ${String(error)}`));
            return;
          }

          const status = response.statusCode ?? 0;
          if (status >= 400) {
            reject(new Error(parsed.error?.message || `OpenAI HTTP ${status}`));
            return;
          }

          const b64 = parsed.data?.[0]?.b64_json;
          if (!b64) {
            reject(new Error("OpenAI returned no image data."));
            return;
          }
          resolve({ b64 });
        });
      },
    );

    request.on("error", (error) => reject(error));
    request.write(body);
    request.end();
  });
}
