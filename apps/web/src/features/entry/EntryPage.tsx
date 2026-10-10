import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { session } from "../../shared/session";

export function EntryPage() {
	const [name, setName] = useState(session.name());
	const [params] = useSearchParams();
	const expired = params.get("expired") === "1";
	const navigate = useNavigate();

	function submit(event: FormEvent) {
		event.preventDefault();
		const value = name.trim();
		if (!value) return;
		session.setName(value);
		navigate(params.get("next") || "/movies");
	}

	return (
		<main className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-black bg-[url('/assets/cover.webp')] bg-cover bg-center p-6">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(0,0,0,.28),rgba(0,0,0,.79)_80%)]" />
			<div className="kult-noise absolute -inset-1/2 z-1 animate-[kult-noise_.28s_steps(2)_infinite] bg-[url('/assets/whitenoise.webp')] bg-cover bg-center opacity-[.035] mix-blend-screen" />
			<section className="relative z-2 w-full max-w-[470px] rounded-[30px] border border-white/10 bg-[#1c1c1ec2] p-[25px] shadow-[0_40px_120px_rgba(0,0,0,.6)] backdrop-blur-[30px] backdrop-saturate-120">
				<img className="mb-10 w-[174px]" src="/assets/kult-wordmark.svg" alt="Kult" />
				<h1 className="mt-2 mb-2.5 text-[clamp(32px,5vw,42px)] leading-none font-bold tracking-[-.055em]">
					{expired ? "Эта комната уже закрыта" : "Как вас зовут?"}
				</h1>

				<form className="mt-8 grid gap-2.5" onSubmit={submit}>
					<input
						className="h-[52px] min-w-0 rounded-[15px] border border-white/10 bg-black/40 px-4 text-white outline-none transition-colors focus:border-white/35"
						id="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						maxLength={32}
						autoFocus
						autoComplete="name"
						placeholder="Ваше имя"
					/>
					<button className="mt-1.5 h-[52px] rounded-[15px] border-0 bg-[#0a84fe] font-semibold! text-[#fffefa]" type="submit">
						{expired ? "Создать новую комнату" : "Продолжить"}
					</button>
				</form>
			</section>
		</main>
	);
}
