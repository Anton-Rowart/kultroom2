import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";

type StreamVariant = {
  filepath: string;
  previewImageFilepath?: string;
  title?: string;
};

type ResolvedMovie = {
  movie: { title?: string; year?: number; posterUrl?: string };
  variant: StreamVariant;
};

@Injectable()
export class MediaService {
  private readonly cacheDir = resolve(process.cwd(), "cache/media");
  private readonly caching = new Set<string>();
  private readonly resolutionCache = new Map<
    string,
    { value: ResolvedMovie; expiresAt: number }
  >();
  private readonly resolutionInFlight = new Map<
    string,
    Promise<ResolvedMovie>
  >();
  private readonly manifestCache = new Map<
    string,
    { text: string; expiresAt: number }
  >();
  private readonly manifestInFlight = new Map<string, Promise<string>>();
  private readonly allowedMediaHosts = new Set(["gorodyshka.link"]);
  private readonly maxBytes = Number(
    process.env.MEDIA_CACHE_MAX_BYTES || 1_610_612_736,
  );
  private readonly ttl = Number(process.env.MEDIA_CACHE_TTL_MS || 7_200_000);
  private readonly resolutionTtl = Number(
    process.env.MEDIA_RESOLVE_TTL_MS || 300_000,
  );
  private readonly manifestTtl = Number(
    process.env.MEDIA_MANIFEST_TTL_MS || 600_000,
  );
  private readonly upstreamTimeout = Number(
    process.env.MEDIA_UPSTREAM_TIMEOUT_MS || 60_000,
  );

  resolveMovie(kinopoiskId: string): Promise<ResolvedMovie> {
    if (!/^\d{1,10}$/.test(kinopoiskId))
      throw new BadRequestException("Некорректный ID Кинопоиска");
    const cached = this.resolutionCache.get(kinopoiskId);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    if (cached) this.resolutionCache.delete(kinopoiskId);

    const current = this.resolutionInFlight.get(kinopoiskId);
    if (current) return current;

    const resolution = this.resolveMovieFresh(kinopoiskId)
      .then((value) => {
        this.resolutionCache.set(kinopoiskId, {
          value,
          expiresAt: Date.now() + this.resolutionTtl,
        });
        return value;
      })
      .catch((error: unknown) => {
        throw new BadGatewayException(
          error instanceof Error
            ? error.message
            : "Источник временно недоступен",
        );
      })
      .finally(() => this.resolutionInFlight.delete(kinopoiskId));
    this.resolutionInFlight.set(kinopoiskId, resolution);
    return resolution;
  }

  async proxy(rawUrl: string, request: Request, response: Response) {
    const upstream = this.allowedUrl(rawUrl);
    const range = request.headers.range;
    if (/\.m3u8(?:\/|$)/i.test(upstream.pathname)) {
      const text = await this.manifestText(upstream);
      response
        .type("application/vnd.apple.mpegurl")
        .set("cache-control", "no-store")
        .send(this.rewriteManifest(text, upstream, request));
      return;
    }
    const key = createHash("sha256").update(upstream.href).digest("hex");

    if (!range) {
      const cachedFile = await this.freshCachedFile(key);
      if (cachedFile) {
        const info = await stat(cachedFile);
        response.status(200).set({
          "content-type": this.mediaType(upstream.pathname),
          "content-length": String(info.size),
          "cache-control": "private, max-age=3600, immutable",
          "accept-ranges": "bytes",
          "x-kult-cache": "HIT",
        });
        await this.pipeResponse(createReadStream(cachedFile), response);
        return;
      }
    }

    const upstreamResponse = await this.fetchMedia(upstream, range);
    if (!upstreamResponse.ok || !upstreamResponse.body)
      throw new BadGatewayException(`Сегмент: HTTP ${upstreamResponse.status}`);

    this.forwardMediaHeaders(upstreamResponse, response, upstream, Boolean(range));
    const canCache = !range && upstreamResponse.status === 200 && !this.caching.has(key);
    if (!canCache) {
      response.set("x-kult-cache", this.caching.has(key) ? "BYPASS" : "MISS");
      await this.pipeResponse(
        Readable.fromWeb(upstreamResponse.body as never),
        response,
      );
      return;
    }

    this.caching.add(key);
    response.set("x-kult-cache", "MISS");
    const [clientBody, cacheBody] = upstreamResponse.body.tee();
    void this.cacheStream(key, cacheBody)
      .catch(() => undefined)
      .finally(() => this.caching.delete(key));
    await this.pipeResponse(Readable.fromWeb(clientBody as never), response);
  }

  private async resolveMovieFresh(kinopoiskId: string): Promise<ResolvedMovie> {
    const players = await this.json(
      `https://fbphdplay.top/api/players?kinopoisk=${kinopoiskId}`,
    );
    const source = players.data?.find(
      (item: { type?: string; iframeUrl?: string }) =>
        item.type === "Veoveo" && item.iframeUrl,
    );
    if (!source) throw new Error("Совместимый источник не найден");
    const iframeUrl = new URL(source.iframeUrl);
    const movieId = iframeUrl.searchParams.get("movie_id");
    const html = await this.text(iframeUrl.href);
    const token = html.match(/'DLE-API-TOKEN':'([^']+)'/)?.[1];
    const requestId = html.match(/'Iframe-Request-Id':'([^']+)'/)?.[1];
    const baseUrl = html.match(/window\.ENV_BASE_URL='([^']+)'/)?.[1];
    if (!token || !requestId || !baseUrl || !movieId)
      throw new Error("Источник не вернул параметры потока");
    const headers = {
      "CDC-FRIENDLY": "true",
      "DLE-API-TOKEN": token,
      "Iframe-Request-Id": requestId,
      "X-Ancestor-Origin": process.env.WEB_ORIGIN || "http://127.0.0.1:5173",
      "X-Has-Token": "true",
    };
    const [movie, episodes] = await Promise.all([
      this.json(
        `${baseUrl}/catalog-api/contents/${encodeURIComponent(movieId)}`,
        headers,
      ),
      this.json(
        `${baseUrl}/catalog-api/episodes?content-id=${encodeURIComponent(movieId)}`,
        headers,
      ),
    ]);
    const variants = episodes
      .flatMap(
        (episode: { episodeVariants?: StreamVariant[] }) =>
          episode.episodeVariants || [],
      )
      .filter((variant: StreamVariant) => variant.filepath);
    const variant =
      variants.find((item: StreamVariant) =>
        /дуб|многоголос/i.test(item.title || ""),
      ) || variants[0];
    if (!variant) throw new Error("Видеопоток не найден");
    const streamUrl = this.registerStreamUrl(variant.filepath);
    void this.manifestText(streamUrl).catch(() => undefined);
    return {
      movie: {
        title: movie.title,
        year: movie.year,
        posterUrl: movie.posterUrl,
      },
      variant,
    };
  }

  private async freshCachedFile(key: string) {
    const path = resolve(this.cacheDir, key);
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs < this.ttl) return path;
      await unlink(path);
    } catch {}
    return null;
  }

  private manifestText(url: URL) {
    const key = url.href;
    const cached = this.manifestCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.text);
    if (cached) this.manifestCache.delete(key);

    const current = this.manifestInFlight.get(key);
    if (current) return current;

    const request = fetch(url, {
      signal: AbortSignal.timeout(this.upstreamTimeout),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new BadGatewayException(
            `Медиаисточник ответил HTTP ${response.status}`,
          );
        const text = await response.text();
        this.manifestCache.set(key, {
          text,
          expiresAt: Date.now() + this.manifestTtl,
        });
        this.warmDefaultAudioManifest(text, url);
        return text;
      })
      .finally(() => this.manifestInFlight.delete(key));
    this.manifestInFlight.set(key, request);
    return request;
  }

  private warmDefaultAudioManifest(text: string, base: URL) {
    const audioLines = text
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.startsWith("#EXT-X-MEDIA:") &&
          /TYPE=AUDIO(?:,|$)/.test(line) &&
          /URI="[^"]+"/.test(line),
      );
    const line =
      audioLines.find((item) => /DEFAULT=YES(?:,|$)/.test(item)) ||
      audioLines[0];
    const value = line?.match(/URI="([^"]+)"/)?.[1];
    if (!value) return;
    try {
      const audioUrl = this.nested(value, base);
      if (audioUrl.href !== base.href)
        void this.manifestText(audioUrl).catch(() => undefined);
    } catch {}
  }

  private async cacheStream(key: string, body: ReadableStream<Uint8Array>) {
    await mkdir(this.cacheDir, { recursive: true });
    const path = resolve(this.cacheDir, key);
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    const file = await open(temporary, "w");
    try {
      await pipeline(Readable.fromWeb(body as never), file.createWriteStream());
      await rename(temporary, path);
      void this.trimCache();
    } catch {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private forwardMediaHeaders(
    upstreamResponse: globalThis.Response,
    response: Response,
    upstream: URL,
    ranged: boolean,
  ) {
    const headers: Record<string, string> = {
      "content-type":
        upstreamResponse.headers.get("content-type") ||
        this.mediaType(upstream.pathname),
      "cache-control": "private, max-age=3600, immutable",
      "accept-ranges":
        upstreamResponse.headers.get("accept-ranges") || "bytes",
    };
    for (const name of ["content-length", "content-range", "last-modified"]) {
      const value = upstreamResponse.headers.get(name);
      if (value) headers[name] = value;
    }
    response.status(upstreamResponse.status).set(headers);
    if (ranged) response.set("vary", "Range");
  }

  private async pipeResponse(stream: NodeJS.ReadableStream, response: Response) {
    try {
      await pipeline(stream, response);
    } catch {
      // A browser can cancel a segment while seeking or changing quality.
      // The stream is already rejected by pipeline; forwarding the same error
      // to Express can emit it again after the pipeline listeners are removed.
      if (!response.destroyed) response.destroy();
    }
  }

  private async fetchMedia(upstream: URL, range?: string) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("Медиаисточник не ответил вовремя")),
      this.upstreamTimeout,
    );
    timer.unref();
    try {
      // This timeout protects only the connection and response headers. Media
      // bodies can legitimately stream for longer than a minute.
      return await fetch(upstream, {
        headers: range ? { range } : {},
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async trimCache() {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(this.cacheDir).catch(() => []);
    const files = await Promise.all(
      entries
        .filter((name) => !name.endsWith(".tmp"))
        .map(async (name) => ({
          path: resolve(this.cacheDir, name),
          info: await stat(resolve(this.cacheDir, name)),
        })),
    );
    let total = files.reduce((sum, file) => sum + file.info.size, 0);
    for (const file of files.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)) {
      if (total <= this.maxBytes) break;
      await unlink(file.path).catch(() => undefined);
      total -= file.info.size;
    }
  }

  private allowedUrl(value: string) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !this.allowedMediaHosts.has(url.hostname) ||
      !url.pathname.startsWith("/content-router/r/")
    )
      throw new BadRequestException("Недопустимый адрес медиапотока");
    return url;
  }
  private registerStreamUrl(value: string) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.pathname.startsWith("/content-router/r/")
    ) {
      throw new Error("Источник вернул недопустимый адрес медиапотока");
    }
    this.allowedMediaHosts.add(url.hostname);
    return url;
  }
  private mediaType(pathname: string) {
    if (/\.vtt(?:$|\/)/i.test(pathname)) return "text/vtt; charset=utf-8";
    if (/\.aac(?:$|\/)/i.test(pathname)) return "audio/aac";
    if (/\.ts(?:$|\/)/i.test(pathname)) return "video/mp2t";
    return "video/mp4";
  }
  private nested(value: string, base: URL) {
    const url = new URL(value, base);
    if (
      this.allowedMediaHosts.has(url.hostname) &&
      /^\/\d+\//.test(url.pathname)
    )
      url.pathname = `/content-router/r${url.pathname}`;
    if (
      this.allowedMediaHosts.has(base.hostname) &&
      url.protocol === "https:" &&
      url.pathname.startsWith("/content-router/r/")
    ) {
      this.allowedMediaHosts.add(url.hostname);
    }
    return this.allowedUrl(url.href);
  }
  private rewriteManifest(text: string, upstream: URL, request: Request) {
    const origin = `${request.protocol}://${request.get("host")}`;
    const proxy = (value: string) =>
      `${origin}/api/media/proxy?url=${encodeURIComponent(this.nested(value, upstream).href)}`;
    return text
      .split(/\r?\n/)
      .map((line) =>
        !line
          ? line
          : line.startsWith("#")
            ? line.replace(
                /URI="([^"]+)"/g,
                (_, value) => `URI="${proxy(value)}"`,
              )
            : proxy(line),
      )
      .join("\n");
  }
  private async text(url: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
  private async json(url: string, headers?: Record<string, string>) {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<any>;
  }
}
