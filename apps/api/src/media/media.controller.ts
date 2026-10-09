import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { MediaService } from "./media.service";

@Controller("media")
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Get("resolve/:kinopoiskId") resolve(@Param("kinopoiskId") id: string) {
    return this.media.resolveMovie(id);
  }
  @Get("proxy") proxy(
    @Query("url") url: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.media.proxy(url, request, response);
  }
}
