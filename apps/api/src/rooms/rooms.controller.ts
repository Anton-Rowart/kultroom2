import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { MoviesService } from "../movies/movies.service";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
export class RoomsController {
  constructor(
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(MoviesService) private readonly movies: MoviesService,
  ) {}
  @Post() async create(@Body() body: { movieId: string; userId: string }) {
    await this.movies.find(body.movieId);
    return this.rooms.create(body.movieId, body.userId);
  }
  @Get(":id") async find(@Param("id") id: string) {
    const room = this.rooms.summary(id);
    return { ...room, movie: await this.movies.find(room.movieId) };
  }
}
