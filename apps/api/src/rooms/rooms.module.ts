import { Module } from "@nestjs/common";
import { MoviesModule } from "../movies/movies.module";
import { RoomsController } from "./rooms.controller";
import { RoomsGateway } from "./rooms.gateway";
import { RoomsService } from "./rooms.service";

@Module({
  imports: [MoviesModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomsGateway],
})
export class RoomsModule {}
