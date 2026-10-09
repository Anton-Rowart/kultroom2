import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { MoviesService } from "./movies.service";

@Controller("movies")
export class MoviesController {
  constructor(@Inject(MoviesService) private readonly movies: MoviesService) {}
  @Get() list(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.movies.list(
      Number(cursor || 0),
      Math.min(Number(limit || 12), 30),
    );
  }
  @Get(":id") find(@Param("id") id: string) {
    return this.movies.find(id);
  }
  @Post() add(@Body() body: { kinopoiskUrl?: string }) {
    return this.movies.add(body.kinopoiskUrl || "");
  }
}
