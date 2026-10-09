export type Movie = {
  id: string;
  kinopoiskId: string;
  title: string;
  originalTitle?: string;
  year?: number;
  type: "Фильм" | "Сериал" | "Мультфильм";
  kinopoiskUrl: string;
  posterUrl: string;
  createdAt: string;
};
