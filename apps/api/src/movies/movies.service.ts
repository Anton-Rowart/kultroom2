import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MediaService } from "../media/media.service";
import type { Movie } from "./movies.types";

@Injectable()
export class MoviesService {
  private readonly seedPath = resolve(process.cwd(), "data/movies.seed.json");
  private readonly localPath = resolve(process.cwd(), "data/movies.local.json");

  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  async all(): Promise<Movie[]> {
    try {
      return JSON.parse(await readFile(this.localPath, "utf8")) as Movie[];
    } catch {
      return JSON.parse(await readFile(this.seedPath, "utf8")) as Movie[];
    }
  }

  async list(cursor = 0, limit = 12) {
    const movies = (await this.all()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const items = movies.slice(cursor, cursor + limit);
    const nextCursor =
      cursor + items.length < movies.length ? cursor + items.length : null;
    return { items, nextCursor };
  }

  async find(id: string) {
    const movie = (await this.all()).find((item) => item.id === id);
    if (!movie) throw new NotFoundException("Фильм не найден");
    return movie;
  }

  async add(kinopoiskUrl: string) {
    const parsed = this.parseKinopoiskUrl(kinopoiskUrl);
    const movies = await this.all();
    const existingIndex = movies.findIndex(
      (item) => item.kinopoiskId === parsed.id,
    );
    const existing = movies[existingIndex];
    if (existing && !this.isPlaceholder(existing)) return existing;
    const metadata = await this.loadMetadata(parsed.url, parsed.id);
    const movie: Movie = {
      id: parsed.id,
      kinopoiskId: parsed.id,
      kinopoiskUrl: parsed.url,
      createdAt: existing?.createdAt || new Date().toISOString(),
      ...metadata,
    };
    if (existingIndex >= 0) movies[existingIndex] = movie;
    else movies.push(movie);
    await mkdir(dirname(this.localPath), { recursive: true });
    await writeFile(this.localPath, JSON.stringify(movies, null, 2));
    return movie;
  }

  private parseKinopoiskUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException("Вставьте корректную ссылку Кинопоиска");
    }
    const id = url.pathname.match(/\/film\/(\d+)/)?.[1];
    if (!/(^|\.)kinopoisk\.ru$/i.test(url.hostname) || !id)
      throw new BadRequestException("Нужна ссылка вида kinopoisk.ru/film/123/");
    return { id, url: `https://www.kinopoisk.ru/film/${id}/` };
  }

  private async loadMetadata(
    url: string,
    id: string,
  ): Promise<Omit<Movie, "id" | "kinopoiskId" | "kinopoiskUrl" | "createdAt">> {
    const kinopoisk = await this.loadKinopoiskMetadata(url, id).catch(
      () => null,
    );
    if (kinopoisk?.title) return kinopoisk;

    const resolved = await this.media.resolveMovie(id);
    if (!resolved.movie.title)
      throw new BadRequestException("Не удалось получить название фильма");
    return {
      title: resolved.movie.title,
      year: resolved.movie.year,
      type: "Фильм",
      posterUrl:
        resolved.movie.posterUrl ||
        `https://kinopoiskapiunofficial.tech/images/posters/kp/${id}.jpg`,
    };
  }

  private async loadKinopoiskMetadata(
    url: string,
    id: string,
  ): Promise<Omit<Movie, "id" | "kinopoiskId" | "kinopoiskUrl" | "createdAt"> | null> {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 Kultroom/1.0",
        "accept-language": "ru-RU,ru;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const text = (property: string) =>
      html.match(
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)`,
          "i",
        ),
      )?.[1] ??
      html.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
          "i",
        ),
      )?.[1];
    const structured = this.structuredMovie(html);
    const fullTitle = text("og:title") || structured?.name || "";
    const title = this.decodeHtml(fullTitle)
      .replace(/\s+(?:фильм|сериал),?\s*\d{4}.*$/i, "")
      .trim();
    if (!title || /^Фильм\s+\d+$/i.test(title)) return null;
    const yearSource = String(structured?.dateCreated || fullTitle);
    const year = Number(yearSource.match(/(?:19|20)\d{2}/)?.[0]) || undefined;
    return {
      title,
      year,
      type: structured?.type === "TVSeries" ? "Сериал" : "Фильм",
      posterUrl:
        text("og:image") ||
        structured?.image ||
        `https://kinopoiskapiunofficial.tech/images/posters/kp/${id}.jpg`,
    };
  }

  private structuredMovie(html: string) {
    for (const match of html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      try {
        const parsed = JSON.parse(match[1]) as
          | Record<string, unknown>
          | Record<string, unknown>[];
        const values = Array.isArray(parsed) ? parsed : [parsed];
        const item = values.find((value) =>
          ["Movie", "TVSeries"].includes(String(value["@type"] || "")),
        );
        if (item)
          return {
            name: typeof item.name === "string" ? item.name : undefined,
            dateCreated:
              typeof item.dateCreated === "string"
                ? item.dateCreated
                : undefined,
            image: typeof item.image === "string" ? item.image : undefined,
            type: String(item["@type"] || ""),
          };
      } catch {}
    }
    return null;
  }

  private decodeHtml(value: string) {
    return value
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  private isPlaceholder(movie: Movie) {
    return new RegExp(`^Фильм\\s+${movie.kinopoiskId}$`, "i").test(
      movie.title.trim(),
    );
  }
}
