import { FormEvent, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../../shared/api/client";
import { session } from "../../shared/session";
import type { Movie } from "./types";

type Page = { items: Movie[]; nextCursor: number | null };

export function MoviesPage() {
	const [url, setUrl] = useState("");
	const [openingMovieId, setOpeningMovieId] = useState<string | null>(null);
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
	const createRoom = useMutation({
		mutationFn: (movieId: string) =>
			api<{ id: string }>("/rooms", {
				method: "POST",
				body: JSON.stringify({ movieId, userId: session.userId() }),
			}),
		onSuccess: (room) => navigate(`/room/${room.id}`),
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
				<img className="w-[118px]" src="/assets/kult-wordmark.svg" alt="Kult" />
				<span className="text-[#ebebf599]">{session.name()}</span>
			</header>
			<section className="py-12 md:pt-[70px]">
				<h1 className="mt-2 mb-2.5 max-w-[700px] text-[clamp(32px,5vw,54px)] leading-none font-bold tracking-[-.055em]">Коллекция</h1>
				<p className="leading-6 text-[#ebebf599]">Добавьте фильм по ссылке с Кинопоиска или выберите уже сохранённый.</p>
				<form className="mt-[34px] flex max-w-[760px] items-center gap-3 rounded-[18px] border border-white/10 bg-[#1c1c1eaa] py-[7px] pr-[7px] pl-[17px] transition-colors focus-within:border-white/35 max-sm:grid max-sm:grid-cols-[auto_1fr]" onSubmit={submit}>
					<Search size={18} />
					<input className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.kinopoisk.ru/film/…" />
					<button className="flex items-center gap-2 rounded-[15px] border-0 bg-[#f5f5f7] px-[18px] py-[13px] font-semibold text-[#111] disabled:cursor-wait disabled:opacity-70 max-sm:col-span-2 max-sm:justify-center" disabled={add.isPending}>
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
							setOpeningMovieId(movie.id);
							createRoom.mutate(movie.id);
						}}
					>
						<span className="block aspect-2/3 overflow-hidden rounded-3xl border border-white/10 bg-[#1c1c1e]">
							<img className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]" src={movie.posterUrl} alt={movie.title} />
						</span>
						<strong className="mt-3 block truncate text-[15px] leading-5 font-semibold text-[#f5f5f7]">
							{openingMovieId === movie.id ? "Создаём комнату…" : movie.title}
						</strong>
					</button>
				))}
			</section>
			{createRoom.error && (
				<p className="fixed right-6 bottom-6 z-10 m-0 max-w-[min(440px,calc(100vw-48px))] rounded-[14px] border border-[#ff696155] bg-[#2c1215eb] px-[18px] py-3.5 text-[#ffb4ae] shadow-[0_16px_50px_rgba(0,0,0,.6)] backdrop-blur-xl" role="alert">
					Не удалось создать комнату: {createRoom.error.message}
				</p>
			)}
			{movies.hasNextPage && (
				<button className="mx-auto mt-9 block rounded-[15px] border-0 bg-[#f5f5f7] px-6 py-[13px] font-semibold text-[#111]" onClick={() => movies.fetchNextPage()}>
					Показать ещё
				</button>
			)}
		</main>
	);
}
