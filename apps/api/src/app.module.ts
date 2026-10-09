import { Module } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { resolve } from "node:path";
import { MoviesModule } from "./movies/movies.module";
import { RoomsModule } from "./rooms/rooms.module";
import { MediaModule } from "./media/media.module";

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: resolve(process.cwd(), "../web/dist"),
      exclude: /^\/(?:api(?:\/|$)|socket\.io(?:\/|$))/,
    }),
    MoviesModule,
    RoomsModule,
    MediaModule,
  ],
})
export class AppModule {}
