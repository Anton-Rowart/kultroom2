import Hls, {
  ErrorDetails,
  ErrorTypes,
  Events,
  type Level,
} from "hls.js";
import { useEffect, useRef, useState } from "react";
import { api, API_URL } from "../../shared/api/client";
import type { Movie } from "../movies/types";
import "./VideoPlayer.css";

export type PlaybackCommand = {
  position: number;
  status: "playing" | "paused";
  updatedAt: number;
  actorId?: string;
};
export type ReactionEvent = { id: string; emoji: string; name: string };
type PlayerState = "loading" | "error" | "ready" | "playing" | "paused";
type Props = {
  movie: Movie | null;
  command: PlaybackCommand | null;
  reactions: ReactionEvent[];
  notice: string;
  onPlayback: (value: Omit<PlaybackCommand, "updatedAt">) => void;
  onTelemetry: (value: {
    position: number;
    status: "playing" | "paused";
  }) => void;
  onReaction: (emoji: string) => void;
};
type QualityOption = { value: string; label: string };
type BufferedRange = { start: number; end: number };

const QUALITY_PREFERENCE_KEY = "kultroom:video-quality";
const AUTO_MAX_HEIGHT = 720;

const reactionOptions = [
  ["🤡", "Клоун"],
  ["❤️", "Сердце"],
  ["😱", "Удивление"],
  ["🔥", "Огонь"],
  ["🤟", "Рокебол"],
  ["😢", "Грусть"],
  ["🏳️‍🌈", "No homo"],
] as const;

export function VideoPlayer({
  movie,
  command,
  reactions,
  notice,
  onPlayback,
  onTelemetry,
  onReaction,
}: Props) {
  const playerRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingStartedAtRef = useRef(0);
  const remoteRef = useRef(false);
  const failedVoiceNamesRef = useRef(new Set<string>());
  const telemetryRef = useRef(onTelemetry);
  const [state, setState] = useState<PlayerState>("loading");
  const [controls, setControls] = useState(true);
  const [stateTitle, setStateTitle] = useState("Получаем свежий поток…");
  const [stateDescription, setStateDescription] = useState(
    "Ссылка на видео не хранится и создаётся заново для этой сессии.",
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedRanges, setBufferedRanges] = useState<BufferedRange[]>([]);
  const [buffering, setBuffering] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [quality, setQuality] = useState("auto");
  const [qualityTitle, setQualityTitle] = useState("");
  const [voiceOptions, setVoiceOptions] = useState<QualityOption[]>([]);
  const [voice, setVoice] = useState("0");
  const [voiceTitle, setVoiceTitle] = useState("");
  const [canActivate, setCanActivate] = useState(false);
  const [activated, setActivated] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState("");
  const playable =
    activated && state !== "loading" && state !== "error";
  telemetryRef.current = onTelemetry;

  function fail(error: unknown) {
    setState("error");
    setStateTitle("Не удалось загрузить видео");
    setStateDescription(error instanceof Error ? error.message : String(error));
  }

  useEffect(() => {
    if (!movie || !videoRef.current) return;
    let disposed = false;
    let refreshAttempted = false;
    const video = videoRef.current;
    const voiceKey = `kult-test-voice:${movie.kinopoiskId}`;
    setCanActivate(false);
    setActivated(false);
    setActivating(false);
    setActivationError("");
    failedVoiceNamesRef.current.clear();

    async function load(resumeAt = 0) {
      setState("loading");
      setStateTitle("Получаем свежий поток…");
      setStateDescription(
        "Ссылка на видео не хранится и создаётся заново для этой сессии.",
      );
      try {
        const result = await api<{
          movie: { posterUrl?: string };
          variant: { filepath: string; previewImageFilepath?: string };
        }>(`/media/resolve/${movie!.kinopoiskId}`);
        if (disposed) return;
        video.poster =
          result.movie.posterUrl ||
          result.variant.previewImageFilepath ||
          movie!.posterUrl;
        const streamUrl = `${API_URL}/api/media/proxy?url=${encodeURIComponent(result.variant.filepath)}`;
        if (!Hls.isSupported())
          throw new Error("Браузер не поддерживает HLS через MediaSource");
        hlsRef.current?.destroy();
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          capLevelToPlayerSize: false,
          abrBandWidthFactor: 0.72,
          abrBandWidthUpFactor: 0.55,
          abrEwmaFastVoD: 6,
          abrEwmaSlowVoD: 20,
          manifestLoadPolicy: {
            default: {
              maxTimeToFirstByteMs: 30_000,
              maxLoadTimeMs: 60_000,
              timeoutRetry: {
                maxNumRetry: 3,
                retryDelayMs: 1_000,
                maxRetryDelayMs: 8_000,
              },
              errorRetry: {
                maxNumRetry: 3,
                retryDelayMs: 1_000,
                maxRetryDelayMs: 8_000,
              },
            },
          },
          playlistLoadPolicy: {
            default: {
              maxTimeToFirstByteMs: 30_000,
              maxLoadTimeMs: 60_000,
              timeoutRetry: {
                maxNumRetry: 3,
                retryDelayMs: 1_000,
                maxRetryDelayMs: 8_000,
              },
              errorRetry: {
                maxNumRetry: 3,
                retryDelayMs: 1_000,
                maxRetryDelayMs: 8_000,
              },
            },
          },
        });
        hlsRef.current = hls;
        hls.on(Events.MANIFEST_PARSED, (_event, data) => {
          const levels = data.levels || [];
          const options = levels
            .map((level, index) => ({ level, index }))
            .sort(
              (a, b) =>
                (b.level.width * b.level.height || b.level.bitrate) -
                (a.level.width * a.level.height || a.level.bitrate),
            )
            .map(({ level, index }) => ({
              value: String(index),
              label: qualityLabel(level),
            }));
          setQualityOptions(options);
          const preference =
            localStorage.getItem(QUALITY_PREFERENCE_KEY) || "auto";
          const preferredLevel = levels.findIndex(
            (level) => qualityKey(level) === preference,
          );
          if (preference === "auto" || preferredLevel < 0) {
            enableCappedAutoQuality(hls, levels);
            setQuality("auto");
            localStorage.setItem(QUALITY_PREFERENCE_KEY, "auto");
          } else {
            hls.autoLevelCapping = -1;
            hls.currentLevel = preferredLevel;
            hls.nextLevel = preferredLevel;
            setQuality(String(preferredLevel));
          }
          setState("ready");
          if (resumeAt > 0) video.currentTime = resumeAt;
        });
        hls.on(Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          const tracks = data.audioTracks || hls.audioTracks || [];
          setVoiceOptions(
            tracks.map((track, index) => ({
              value: String(index),
              label: track.name || track.lang || `Дорожка ${index + 1}`,
            })),
          );
          let selected = tracks.findIndex(
            (track, index) =>
              track.name === sessionStorage.getItem(voiceKey) &&
              !failedVoiceNamesRef.current.has(trackName(track, index)),
          );
          if (selected < 0)
            selected = tracks.findIndex(
              (track, index) =>
                track.default &&
                !failedVoiceNamesRef.current.has(trackName(track, index)),
            );
          if (selected < 0)
            selected = tracks.findIndex(
              (track, index) =>
                !failedVoiceNamesRef.current.has(trackName(track, index)),
            );
          if (selected >= 0) {
            hls.audioTrack = selected;
            setVoice(String(selected));
            sessionStorage.setItem(voiceKey, trackName(tracks[selected], selected));
          }
        });
        hls.on(Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
          const track = hls.audioTracks[data.id];
          if (track) {
            setVoice(String(data.id));
            setVoiceTitle(
              `Сейчас: ${track.name || track.lang || "Аудиодорожка"}`,
            );
          }
        });
        hls.on(Events.LEVEL_SWITCHED, (_event, data) => {
          const level = hls.levels[data.level];
          if (level) setQualityTitle(`Сейчас: ${qualityLabel(level)}`);
        });
        hls.on(Events.BUFFER_APPENDED, () => updateProgress());
        hls.on(Events.FRAG_BUFFERED, () => updateProgress());
        hls.on(Events.ERROR, async (_event, data) => {
          const audioTrackFailed =
            data.details === ErrorDetails.AUDIO_TRACK_LOAD_ERROR ||
            data.details === ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT;
          if (audioTrackFailed && data.fatal) {
            const failedTrack = hls.audioTracks[hls.audioTrack];
            if (failedTrack)
              failedVoiceNamesRef.current.add(
                trackName(failedTrack, hls.audioTrack),
              );
            sessionStorage.removeItem(voiceKey);
            if (failedVoiceNamesRef.current.size < 3) {
              setVoiceTitle("Озвучка недоступна — переключаем…");
              await load(video.currentTime || 0);
              return;
            }
          }
          if (!data.fatal) return;
          if (data.type === ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          if (!refreshAttempted && data.type === ErrorTypes.NETWORK_ERROR) {
            refreshAttempted = true;
            await load(video.currentTime || 0);
            return;
          }
          fail(new Error(data.details || "Ошибка воспроизведения HLS"));
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
      } catch (error) {
        if (!disposed) fail(error);
      }
    }
    void load();
    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [movie, retryNonce]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !command || !playable) return;
    const target =
      command.status === "playing"
        ? command.position + (Date.now() - command.updatedAt) / 1000
        : command.position;
    remoteRef.current = true;
    if (Math.abs(video.currentTime - target) > 1.25)
      video.currentTime = Math.max(0, target);
    const result =
      command.status === "playing"
        ? video.play()
        : Promise.resolve(video.pause());
    Promise.resolve(result)
      .catch(() => undefined)
      .finally(() =>
        setTimeout(() => {
          remoteRef.current = false;
        }, 150),
      );
  }, [command, playable]);

  useEffect(() => {
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (video)
        telemetryRef.current({
          position: video.currentTime,
          status: video.paused ? "paused" : "playing",
        });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onFullscreen = () => {
      setFullscreen(document.fullscreenElement === playerRef.current);
      showControls();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape" && reactionOpen) {
        setReactionOpen(false);
        return;
      }
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (document.activeElement as HTMLElement | null)?.tagName || "",
        )
      )
        return;
      if (!activated) return;
      const video = videoRef.current;
      if (!video) return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
      }
      if (event.code === "ArrowLeft")
        video.currentTime = Math.max(0, video.currentTime - 10);
      if (event.code === "ArrowRight")
        video.currentTime = Math.min(
          video.duration || Infinity,
          video.currentTime + 10,
        );
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("keydown", onKey);
    };
  }, [activated, reactionOpen]);

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video || !activated) return;
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      fail(error);
    }
  }
  async function activatePlayer() {
    const video = videoRef.current;
    if (!video || !canActivate || activating) return;
    setActivating(true);
    setActivationError("");
    remoteRef.current = true;
    try {
      await video.play();
      video.pause();
      video.currentTime = 0;
      updateProgress();
      setState("paused");
      setActivated(true);
    } catch (error) {
      setActivationError(
        error instanceof Error
          ? error.message
          : "Не удалось активировать плеер",
      );
    } finally {
      setActivating(false);
      setTimeout(() => {
        remoteRef.current = false;
      }, 250);
    }
  }
  function showControls() {
    setControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (!videoRef.current?.paused)
      controlsTimerRef.current = setTimeout(() => setControls(false), 2200);
  }
  function startBuffering() {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    bufferingStartedAtRef.current = performance.now();
    setBuffering(true);
  }
  function stopBuffering() {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current);
    const delay = Math.max(
      0,
      350 - (performance.now() - bufferingStartedAtRef.current),
    );
    bufferingTimerRef.current = setTimeout(() => setBuffering(false), delay);
  }
  function updateProgress() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(mediaDuration);
    if (!mediaDuration) {
      setBufferedRanges([]);
      return;
    }
    setBufferedRanges(
      Array.from({ length: video.buffered.length }, (_, index) => ({
        start: Math.max(
          0,
          Math.min(100, (video.buffered.start(index) / mediaDuration) * 100),
        ),
        end: Math.max(
          0,
          Math.min(100, (video.buffered.end(index) / mediaDuration) * 100),
        ),
      })).filter((range) => range.end > range.start),
    );
  }
  function emitPlayback() {
    const video = videoRef.current;
    if (video && !remoteRef.current)
      onPlayback({
        position: video.currentTime,
        status: video.paused ? "paused" : "playing",
        actorId: "",
      });
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await playerRef.current?.requestFullscreen();
  }
  function toggleReactionPanel() {
    const next = !reactionOpen;
    setReactionOpen(next);
    if (next) {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      setControls(true);
    } else showControls();
  }
  const played = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <section
      ref={playerRef}
      className="kult-player"
      data-state={state}
      data-controls={String(controls)}
      data-buffering={String(buffering)}
      data-activated={String(activated)}
      onPointerMove={showControls}
      onPointerLeave={() => {
        if (!videoRef.current?.paused) setControls(false);
      }}
    >
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        onClick={() => void togglePlayback()}
        onPlay={() => {
          setState("playing");
          stopBuffering();
          showControls();
          emitPlayback();
        }}
        onPause={() => {
          if (state !== "loading" && state !== "error") setState("paused");
          showControls();
          emitPlayback();
        }}
        onSeeking={startBuffering}
        onSeeked={stopBuffering}
        onWaiting={startBuffering}
        onCanPlay={() => {
          setCanActivate(true);
          stopBuffering();
        }}
        onPlaying={stopBuffering}
        onTimeUpdate={updateProgress}
        onDurationChange={updateProgress}
        onProgress={updateProgress}
      />
      <div
        className="activation-gate"
        role="dialog"
        aria-modal="true"
        aria-busy={!canActivate || activating}
        aria-label="Активация совместного просмотра"
      >
        {!canActivate ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <strong>Загружаем фильм…</strong>
          </>
        ) : (
          <>
            <button
              className="activation-button"
              type="button"
              disabled={activating}
              onClick={() => void activatePlayer()}
            >
              {activating
                ? "Активируем…"
                : "Активировать совместный просмотр"}
            </button>
            {activationError && (
              <p className="activation-error" role="alert">
                {activationError}
              </p>
            )}
          </>
        )}
      </div>
      <div className="shade" />
      <h1 className="movie-title">{movie?.title || "Фильм"}</h1>
      <div className="buffering-indicator" aria-label="Загрузка видео">
        <span className="spinner" aria-hidden="true" />
      </div>
      <div className="reaction-layer" aria-live="polite">
        {reactions.slice(-8).map((item) => (
          <div
            className="reaction-float"
            key={item.id}
            style={
              {
                "--right": `${16 + (hash(item.id) % 45)}px`,
                "--drift": `${-28 + (hash(`${item.id}d`) % 57)}px`,
              } as React.CSSProperties
            }
          >
            <span className="reaction-float__emoji">{item.emoji}</span>
            <span className="reaction-float__name">{item.name}</span>
          </div>
        ))}
      </div>
      <div className="player-notices" aria-live="polite">
        {notice && (
          <div className="player-notice" key={notice}>
            {notice}
          </div>
        )}
      </div>
      <div className="state" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <strong>{stateTitle}</strong>
        <p>{stateDescription}</p>
        <button
          className="retry"
          type="button"
          onClick={() => setRetryNonce((value) => value + 1)}
        >
          Повторить
        </button>
      </div>
      <button
        className="center-play"
        type="button"
        aria-label="Воспроизвести"
        onClick={() => void togglePlayback()}
      >
        ▶
      </button>
      {reactionOpen && (
        <div className="reaction-panel">
          <div className="reaction-options" aria-label="Реакции">
            {reactionOptions.map(([emoji, label]) => (
              <button
                className="reaction-option"
                type="button"
                key={emoji}
                aria-label={label}
                onClick={() => {
                  setReactionOpen(false);
                  onReaction(emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="controls">
        <div className="timeline-wrap">
          <div className="timeline-base" />
          <div className="timeline-buffered" aria-hidden="true">
            {bufferedRanges.map((range, index) => (
              <span
                key={`${index}-${range.start}-${range.end}`}
                style={{
                  left: `${range.start}%`,
                  width: `${range.end - range.start}%`,
                }}
              />
            ))}
          </div>
          <input
            className="timeline"
            type="range"
            min="0"
            max="100"
            value={played}
            step="0.01"
            aria-label="Позиция видео"
            style={{ "--played": `${played}%` } as React.CSSProperties}
            onInput={(event) => {
              const video = videoRef.current;
              if (video && Number.isFinite(video.duration)) {
                video.currentTime =
                  video.duration * (Number(event.currentTarget.value) / 100);
                updateProgress();
              }
            }}
            onPointerUp={emitPlayback}
          />
        </div>
        <div className="control-row">
          <button
            className="icon-button"
            type="button"
            aria-label={state === "playing" ? "Пауза" : "Воспроизвести"}
            onClick={() => void togglePlayback()}
          >
            {state === "playing" ? "Ⅱ" : "▶"}
          </button>
          <span className="time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <input
            className="volume"
            type="range"
            min="0"
            max="1"
            defaultValue="0.8"
            step="0.05"
            aria-label="Громкость"
            onInput={(event) => {
              if (videoRef.current)
                videoRef.current.volume = Number(event.currentTarget.value);
            }}
          />
          <span className="spacer" />
          <select
            className="badge quality-select voice-select"
            aria-label="Озвучка"
            value={voice}
            title={voiceTitle}
            disabled={voiceOptions.length < 2}
            onChange={(event) => {
              const index = Number(event.target.value);
              const track = hlsRef.current?.audioTracks[index];
              if (!track || !movie) return;
              hlsRef.current!.audioTrack = index;
              setVoice(event.target.value);
              const name = track.name || track.lang || `Дорожка ${index + 1}`;
              sessionStorage.setItem(
                `kult-test-voice:${movie.kinopoiskId}`,
                name,
              );
              setVoiceTitle(`Сейчас: ${name}`);
            }}
          >
            {voiceOptions.length ? (
              voiceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            ) : (
              <option value="0">Одна дорожка</option>
            )}
          </select>
          <select
            className="badge quality-select"
            aria-label="Качество видео"
            value={quality}
            title={qualityTitle}
            onChange={(event) => {
              const hls = hlsRef.current;
              if (!hls) return;
              setQuality(event.target.value);
              if (event.target.value === "auto") {
                enableCappedAutoQuality(hls, hls.levels);
                localStorage.setItem(QUALITY_PREFERENCE_KEY, "auto");
              } else {
                const index = Number(event.target.value);
                const level = hls.levels[index];
                if (!level) return;
                hls.autoLevelCapping = -1;
                hls.currentLevel = index;
                hls.nextLevel = index;
                localStorage.setItem(QUALITY_PREFERENCE_KEY, qualityKey(level));
              }
            }}
          >
            <option value="auto">Auto · до 720p</option>
            {qualityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            type="button"
            aria-label={reactionOpen ? "Закрыть реакции" : "Открыть реакции"}
            aria-expanded={reactionOpen}
            onClick={toggleReactionPanel}
          >
            ☺
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={fullscreen ? "Свернуть" : "На весь экран"}
            onClick={() => void toggleFullscreen()}
          >
            ⛶
          </button>
        </div>
      </div>
    </section>
  );
}

function qualityWeight(level: Level) {
  return level.width * level.height || level.bitrate || 0;
}
function trackName(track: { name?: string; lang?: string }, index?: number) {
  return track.name || track.lang || `Дорожка ${(index ?? 0) + 1}`;
}
function qualityLabel(level: Level) {
  if (level.width && level.height) return `${level.width}×${level.height}`;
  if (level.height) return `${level.height}p`;
  return `${Math.round((level.bitrate || 0) / 1000)} Кбит/с`;
}
function qualityKey(level: Level) {
  return `${level.width || 0}x${level.height || 0}`;
}
function enableCappedAutoQuality(hls: Hls, levels: Level[]) {
  hls.autoLevelCapping = autoQualityCap(levels);
  hls.currentLevel = -1;
  hls.nextLevel = -1;
}
function autoQualityCap(levels: Level[]) {
  if (!levels.length) return -1;
  const eligible = levels
    .map((level, index) => ({ level, index }))
    .filter(({ level }) =>
      level.height
        ? level.height <= AUTO_MAX_HEIGHT
        : level.width
          ? level.width <= 1280
          : true,
    );
  const available = eligible.length
    ? eligible
    : levels.map((level, index) => ({ level, index }));
  return available.reduce((best, current) =>
    qualityWeight(current.level) > qualityWeight(best.level) ? current : best,
  ).index;
}
function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function hash(value: string) {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}
