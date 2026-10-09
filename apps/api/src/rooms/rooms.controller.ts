import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { MoviesService } from "../movies/movies.service";
import { MediaService } from "../media/media.service";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
export class RoomsController {
  constructor(
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(MoviesService) private readonly movies: MoviesService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}
  @Post() async create(
    @Body()
    body: { movieId: string; userId: string; audioTrackName?: string },
  ) {
    const movie = await this.movies.find(body.movieId);
    const tracks = await this.media.audioTracks(movie.kinopoiskId);
    const selected = body.audioTrackName
      ? tracks.find((track) => track.name === body.audioTrackName)
      : tracks.find((track) => track.default) || tracks[0];
    return this.rooms.create(body.movieId, body.userId, selected?.name || "");
  }
  @Get(":id") async find(@Param("id") id: string) {
    const room = this.rooms.summary(id);
    return { ...room, movie: await this.movies.find(room.movieId) };
  }
}
