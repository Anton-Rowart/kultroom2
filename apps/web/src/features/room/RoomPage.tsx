import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { useParams } from "react-router";
import { io, type Socket } from "socket.io-client";
import { api, API_URL } from "../../shared/api/client";
import { createId, session } from "../../shared/session";
import type { Movie } from "../movies/types";
import { VideoPlayer, type PlaybackCommand } from "./VideoPlayer";

type Participant = {
  id: string;
  name: string;
  isHost: boolean;
  position: number;
  status: "playing" | "paused";
  ping: number;
};
type RoomState = {
  id: string;
  movieId: string;
  audioTrackName: string;
  hostId: string;
  participants: Participant[];
  playback: PlaybackCommand;
};
export function RoomPage() {
  const { roomId = "" } = useParams();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [command, setCommand] = useState<PlaybackCommand | null>(null);
  const [open, setOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [reactions, setReactions] = useState<
    { id: string; emoji: string; name: string }[]
  >([]);
  const [notice, setNotice] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const pingRef = useRef(0);
  const userId = useMemo(() => session.userId(), []);
  useEffect(() => {
    api<RoomState & { movie: Movie }>(`/rooms/${roomId}`)
      .then((data) => {
        setMovie(data.movie);
        setState(data);
        setCommand(data.playback);
      })
      .catch(() => location.assign("/?expired=1"));
  }, [roomId]);
  useEffect(() => {
    const socket = io(`${API_URL}/rooms`, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () =>
      socket.emit("room:join", { roomId, userId, name: session.name() }),
    );
    socket.on("room:state", setState);
    socket.on("playback:update", (value: PlaybackCommand) => setCommand(value));
    socket.on(
      "reaction",
      ({ emoji, name }: { emoji: string; name: string }) => {
        const id = createId();
        setReactions((items) => [
          ...items.slice(-7),
          { id, emoji, name: name || "Пользователь" },
        ]);
        setTimeout(
          () => setReactions((items) => items.filter((item) => item.id !== id)),
          4000,
        );
      },
    );
    socket.on(
      "player:notice",
      ({ name, action }: { name: string; action: string }) => {
        setNotice(
          `${name} ${action === "playing" ? "запустил воспроизведение" : "поставил на паузу"}`,
        );
        setTimeout(() => setNotice(""), 2500);
      },
    );
    socket.on("room:error", () => location.assign("/?expired=1"));
    const pingTimer = setInterval(async () => {
      const startedAt = performance.now();
      try {
        await socket.timeout(2000).emitWithAck("ping");
        pingRef.current = Math.round(performance.now() - startedAt);
      } catch {
        pingRef.current = 2000;
      }
    }, 5000);
    return () => {
      clearInterval(pingTimer);
      socket.disconnect();
    };
  }, [roomId, userId]);
  async function share() {
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(location.href);
      } else if (!copyWithoutClipboardApi(location.href)) {
        throw new Error("Браузер запретил копирование");
      }
      setShareStatus("copied");
    } catch {
      setShareStatus("error");
    }
    setTimeout(() => setShareStatus("idle"), 1800);
  }
  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-[#f5f5f7]">
      <VideoPlayer
        movie={movie}
        audioTrackName={state?.audioTrackName || ""}
        command={command}
        reactions={reactions}
        notice={notice}
        onPlayback={(value) =>
          socketRef.current?.emit("playback:update", {
            ...value,
            roomId,
            userId,
          })
        }
        onTelemetry={(value) =>
          socketRef.current?.emit("telemetry", {
            ...value,
            roomId,
            userId,
            ping: pingRef.current,
          })
        }
        onReaction={(emoji) =>
          socketRef.current?.emit("reaction", { roomId, userId, emoji })
        }
      />
      <button
        className={`fixed top-6 right-6 z-40 size-[54px] rounded-[17px] border-0 bg-transparent p-0 shadow-[0_12px_40px_rgba(0,0,0,.53)] transition duration-250 ${open ? "pointer-events-none translate-x-5 opacity-0" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="Открыть комнату"
      >
        <img className="size-full" src="/assets/kult-mark.svg" alt="K" />
      </button>
      <aside className={`fixed top-3.5 right-3.5 bottom-3.5 z-50 flex w-[min(440px,calc(100vw-28px))] flex-col gap-8 rounded-[28px] border border-white/10 bg-[#2c2c2ef2] p-5 shadow-[0_30px_90px_rgba(0,0,0,.73)] backdrop-blur-[34px] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${open ? "translate-x-0" : "translate-x-[calc(100%+28px)]"}`}>
        <header className="flex items-center justify-between">
          <img className="w-28" src="/assets/kult-wordmark.svg" alt="Kult" />
          <button className="grid size-[38px] place-items-center rounded-full border-0 bg-white/5" onClick={() => setOpen(false)} aria-label="Закрыть">
            <X />
          </button>
        </header>
        <section className="flex min-h-0 flex-1 flex-col gap-5">
          <header className="flex items-center justify-between px-0.5">
            <h2 className="m-0 text-xs font-bold tracking-[.14em] text-[#ebebf599] uppercase">
              Участники
            </h2>
            <span className="grid min-w-10 place-items-center rounded-full bg-white/[.07] px-3 py-1.5 text-sm font-semibold text-[#f5f5f7]">
              {state?.participants.length ?? 0}
            </span>
          </header>
          <div className="grid gap-2.5 overflow-auto">
            {state?.participants.map((person) => (
            <article
              className={`grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[22px] border bg-white/[.035] px-4 py-3.5 transition-colors ${person.id === userId ? "border-[#0a84ff]/75 ring-1 ring-[#0a84ff]/25" : "border-white/10"}`}
              key={person.id}
            >
              <span className="grid size-14 place-items-center rounded-full bg-black/10 text-xl font-bold">
                {person.name[0]?.toUpperCase()}
              </span>
              <div className="grid min-w-0 gap-1.5">
                <div className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
                  <strong className="min-w-0 shrink truncate">
                    {person.name}
                  </strong>
                  <span
                    className={`size-2 shrink-0 rounded-full ${connectionColor(person.ping)}`}
                    aria-label={person.ping ? `Пинг ${person.ping} миллисекунд` : "Ожидаем данные соединения"}
                  />
                  <span className="shrink-0 text-sm font-medium text-[#ebebf599]">
                    {person.ping ? `${person.ping} мс` : "— мс"}
                  </span>
                </div>
                <small className="truncate text-sm font-medium text-[#ebebf599]">
                  <b className="font-semibold text-[#f5f5f7]">{formatTime(person.position)}</b>
                  <span className="mx-2">·</span>
                  {person.ping
                    ? person.status === "playing"
                      ? "смотрит"
                      : "пауза"
                    : "ожидаем данные"}
                </small>
              </div>
              <div className="flex items-center gap-1.5 self-start pt-1">
                {person.isHost && (
                  <em className="rounded-full bg-[#0a84ff28] px-2.5 py-1 text-[9px] font-bold tracking-[.04em] whitespace-nowrap not-italic text-[#64adff] uppercase">
                    создатель
                  </em>
                )}
              </div>
            </article>
            ))}
          </div>
        </section>
        <button type="button" className="mt-auto flex cursor-pointer items-center justify-center gap-2 rounded-[15px] border-0 bg-[#f5f5f7] p-3.5 font-semibold text-[#111]" onClick={() => void share()}>
          {shareStatus === "copied" ? <Check /> : <Copy />}
          {shareStatus === "copied"
            ? "Ссылка скопирована"
            : shareStatus === "error"
              ? "Не удалось скопировать"
              : "Поделиться"}
        </button>
      </aside>
    </main>
  );
}
function copyWithoutClipboardApi(value: string) {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}
function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function connectionColor(ping: number) {
  if (!ping) return "bg-[#8e8e93]";
  if (ping < 180) return "bg-[#30d158]";
  if (ping < 450) return "bg-[#ffd60a]";
  return "bg-[#ff453a]";
}
