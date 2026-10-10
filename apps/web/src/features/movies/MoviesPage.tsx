import { FormEvent, useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Volume2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../../shared/api/client";
import { session } from "../../shared/session";
import type { Movie } from "./types";

type Page = { items: Movie[]; nextCursor: number | null };
type AudioTrack = {
	name: string;
	language?: string;
	default: boolean;
};

export function MoviesPage() {
	const [url, setUrl] = useState("");
	const [openingMovieId, setOpeningMovieId] = useState<string | null>(null);
	const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
	const [selectedAudio, setSelectedAudio] = useState("");
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const movies = useInfiniteQuery({
		queryKey: ["movies"],
		initialPageParam: 0,
		queryFn: ({ pageParam }) => api<Page>(`/movies?cursor=${pageParam}&limit=12`),
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});
	const add = useMutation({
		mutationFn: (kinopoiskUrl: string) =>
			api<Movie>("/movies", {
				method: "POST",
				body: JSON.stringify({ kinopoiskUrl }),
			}),
		onSuccess: () => {
			setUrl("");
			void queryClient.invalidateQueries({ queryKey: ["movies"] });
		},
	});
	const audioTracks = useQuery({
		queryKey: ["audio-tracks", selectedMovie?.kinopoiskId],
		queryFn: () => api<AudioTrack[]>(`/media/audio-tracks/${selectedMovie!.kinopoiskId}`),
		enabled: Boolean(selectedMovie),
		staleTime: 5 * 60_000,
	});
	useEffect(() => {
		if (!audioTracks.data) return;
		setSelectedAudio(audioTracks.data.find((track) => track.default)?.name || audioTracks.data[0]?.name || "");
	}, [audioTracks.data]);
	const createRoom = useMutation({
		mutationFn: ({ movieId, audioTrackName }: { movieId: string; audioTrackName: string }) =>
			api<{ id: string }>("/rooms", {
				method: "POST",
				body: JSON.stringify({
					movieId,
					userId: session.userId(),
					audioTrackName,
				}),
			}),
		onSuccess: (room) => {
			setSelectedMovie(null);
			navigate(`/room/${room.id}`);
		},
		onSettled: () => setOpeningMovieId(null),
	});
	function submit(event: FormEvent) {
		event.preventDefault();
		if (url.trim()) add.mutate(url.trim());
	}
	const items = movies.data?.pages.flatMap((page) => page.items) ?? [];

	return (
		<main className="min-h-dvh bg-[radial-gradient(circle_at_15%_0,rgba(64,32,83,.33),transparent_35%)] bg-[#080808] px-[max(24px,calc((100vw-1400px)/2))] pb-20 text-[#f5f5f7]">
			<header className="flex h-[88px] items-center justify-between">
				<img className="w-[200px]" src="/assets/kult-wordmark.svg" alt="Kult" />
				<span className="text-[#fffefa] text-lg font-bold">{session.name()}</span>
			</header>
			<section className="py-12 md:pt-[20px]">
				<h1 className="mt-2 mb-2.5 max-w-[700px] text-[clamp(32px,5vw,42px)] leading-none font-bold tracking-[-.055em]">Коллекция</h1>
				<form
					className="mt-[34px] flex max-w-[760px] items-center gap-3 rounded-[18px] border border-white/10 bg-[#1c1c1eaa] py-[7px] pr-[7px] pl-[17px] transition-colors focus-within:border-white/35 max-sm:grid max-sm:grid-cols-[auto_1fr]"
					onSubmit={submit}
				>
					<Search size={18} />
					<input
						className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://www.kinopoisk.ru/film/…"
					/>
					<button
						className="flex items-center gap-2 rounded-[15px] border-0 bg-[#f5f5f7] px-[18px] py-[13px] font-semibold text-[#111] disabled:cursor-wait disabled:opacity-70 max-sm:col-span-2 max-sm:justify-center"
						disabled={add.isPending}
					>
						<Plus size={18} />
						{add.isPending ? "Добавляем…" : "Добавить"}
					</button>
				</form>
				{add.error && <p className="text-[#ff6961]">{add.error.message}</p>}
			</section>
			<section className="grid grid-cols-2 gap-x-[18px] gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
				{items.map((movie) => (
					<button
						className="group min-w-0 border-0 bg-transparent p-0 text-left disabled:cursor-wait disabled:opacity-80"
						key={movie.id}
						disabled={createRoom.isPending}
						onClick={() => {
							setSelectedAudio("");
							setSelectedMovie(movie);
						}}
					>
						<span className="block aspect-2/3 overflow-hidden rounded-3xl border border-white/10 bg-[#1c1c1e]">
							<img
								className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"
								src={movie.posterUrl}
								alt={movie.title}
							/>
						</span>
						<strong className="mt-3 block truncate text-[15px] leading-5 font-semibold text-[#f5f5f7]">
							{openingMovieId === movie.id ? "Создаём комнату…" : movie.title}
						</strong>
					</button>
				))}
			</section>
			{selectedMovie && (
				<div
					className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-5 backdrop-blur-xl"
					role="presentation"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget && !createRoom.isPending) setSelectedMovie(null);
					}}
				>
					<section
						className="w-full max-w-[520px] rounded-[28px] border border-white/10 bg-[#1c1c1ef5] p-5 shadow-[0_30px_100px_rgba(0,0,0,.75)]"
						role="dialog"
						aria-modal="true"
						aria-labelledby="audio-dialog-title"
					>
						<header className="flex items-start gap-4">
							<img className="h-[120px] w-20 rounded-[14px] object-cover" src={selectedMovie.posterUrl} alt="" />
							<div className="min-w-0 flex-1 pt-1">
								<p className="m-0 text-sm text-[#ebebf599]">Создание комнаты</p>
								<h2 id="audio-dialog-title" className="mt-1 mb-0 text-2xl font-bold tracking-[-.035em]">
									{selectedMovie.title}
								</h2>
							</div>
							<button
								type="button"
								className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-white/[.07] text-white"
								disabled={createRoom.isPending}
								onClick={() => setSelectedMovie(null)}
								aria-label="Закрыть"
							>
								<X size={20} />
							</button>
						</header>
						<div className="mt-6">
							<h3 className="m-0 text-lg font-semibold mb-2">Выберите перевод</h3>
							{audioTracks.isPending ? (
								<div className="rounded-[16px] border border-white/10 bg-white/[.04] p-4 text-sm text-[#ebebf599]">
									Получаем доступные переводы…
								</div>
							) : audioTracks.isError ? (
								<button
									type="button"
									className="w-full cursor-pointer rounded-[16px] border border-[#ff696155] bg-[#2c1215] p-4 text-left text-sm text-[#ffb4ae]"
									onClick={() => void audioTracks.refetch()}
								>
									Не удалось загрузить переводы. Нажмите, чтобы повторить.
								</button>
							) : audioTracks.data?.length ? (
								<div className="grid max-h-[250px] gap-2 overflow-auto">
									{audioTracks.data.map((track) => (
										<button
											type="button"
											key={`${track.name}:${track.language || ""}`}
											className={`flex cursor-pointer items-center gap-3 rounded-[16px] border px-4 py-3 text-left transition ${selectedAudio === track.name ? "border-[#0a84ff] bg-[#0a84ff]/15" : "border-white/10 bg-white/[.04] hover:bg-white/[.07]"}`}
											onClick={() => setSelectedAudio(track.name)}
										>
											<Volume2 size={18} className="shrink-0" />
											<span className="min-w-0 flex-1 truncate font-medium">{track.name}</span>
											{track.default && <small className="shrink-0 text-[#ebebf599]">по умолчанию</small>}
										</button>
									))}
								</div>
							) : (
								<div className="rounded-[16px] border border-white/10 bg-white/[.04] p-4 text-sm">Встроенная звуковая дорожка</div>
							)}
						</div>
						<button
							type="button"
							className="mt-6 w-full cursor-pointer rounded-[16px] border-0 px-5 py-4 bg-[#0a84fe] font-semibold! text-[#fffefa] disabled:cursor-wait disabled:opacity-60"
							disabled={audioTracks.isPending || audioTracks.isError || createRoom.isPending}
							onClick={() => {
								setOpeningMovieId(selectedMovie.id);
								createRoom.mutate({ movieId: selectedMovie.id, audioTrackName: selectedAudio });
							}}
						>
							{createRoom.isPending ? "Создаём комнату…" : "Создать комнату"}
						</button>
					</section>
				</div>
			)}
			{createRoom.error && (
				<p
					className="fixed right-6 bottom-6 z-10 m-0 max-w-[min(440px,calc(100vw-48px))] rounded-[14px] border border-[#ff696155] bg-[#2c1215eb] px-[18px] py-3.5 text-[#ffb4ae] shadow-[0_16px_50px_rgba(0,0,0,.6)] backdrop-blur-xl"
					role="alert"
				>
					Не удалось создать комнату: {createRoom.error.message}
				</p>
			)}
			{movies.hasNextPage && (
				<button
					className="mx-auto mt-9 block rounded-[15px] border-0 bg-[#f5f5f7] px-6 py-[13px] font-semibold text-[#111]"
					onClick={() => movies.fetchNextPage()}
				>
					Показать ещё
				</button>
			)}
		</main>
	);
}
