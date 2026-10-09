import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Inject } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import { RoomsService } from "./rooms.service";

@WebSocketGateway({
  namespace: "/rooms",
  cors: { origin: true, credentials: true },
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}
  handleConnection(client: Socket) {
    client.emit("connected", { serverTime: Date.now() });
  }
  handleDisconnect(client: Socket) {
    const roomId = this.rooms.leave(client.id);
    if (roomId) this.broadcastState(roomId);
  }

  @SubscribeMessage("room:join")
  join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; userId: string; name: string },
  ) {
    try {
      this.rooms.join(body.roomId, {
        id: body.userId,
        socketId: client.id,
        name: body.name.slice(0, 32) || "Пользователь",
      });
      void client.join(body.roomId);
      this.broadcastState(body.roomId);
    } catch (error) {
      client.emit("room:error", {
        message: error instanceof Error ? error.message : "Не удалось войти",
      });
    }
  }

  @SubscribeMessage("playback:update")
  playback(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      roomId: string;
      userId: string;
      position: number;
      status: "playing" | "paused";
    },
  ) {
    const room = this.rooms.get(body.roomId);
    const user = room.participants.get(body.userId);
    if (!user || user.socketId !== client.id) return;
    room.playback = {
      position: Math.max(0, Number(body.position) || 0),
      status: body.status,
      updatedAt: Date.now(),
      actorId: body.userId,
    };
    user.position = room.playback.position;
    user.status = body.status;
    client.to(body.roomId).emit("playback:update", room.playback);
    this.server
      .to(body.roomId)
      .emit("player:notice", { name: user.name, action: body.status });
  }

  @SubscribeMessage("reaction")
  reaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; userId: string; emoji: string },
  ) {
    const allowed = new Set(["🤡", "❤️", "😱", "🔥", "🤟", "😢", "🏳️‍🌈"]);
    const room = this.rooms.get(body.roomId);
    const user = room.participants.get(body.userId);
    if (user?.socketId === client.id && allowed.has(body.emoji))
      this.server.to(body.roomId).emit("reaction", {
        emoji: body.emoji,
        userId: body.userId,
        name: user.name,
      });
  }

  @SubscribeMessage("telemetry")
  telemetry(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      roomId: string;
      userId: string;
      position: number;
      status: "playing" | "paused";
      ping: number;
    },
  ) {
    const room = this.rooms.get(body.roomId);
    const user = room.participants.get(body.userId);
    if (!user || user.socketId !== client.id) return;
    Object.assign(user, {
      position: Math.max(0, body.position || 0),
      status: body.status,
      ping: Math.max(0, Math.round(body.ping || 0)),
    });
    this.broadcastState(body.roomId);
  }

  @SubscribeMessage("ping")
  ping() {
    return { serverTime: Date.now() };
  }

  private broadcastState(roomId: string) {
    try {
      this.server.to(roomId).emit("room:state", this.rooms.summary(roomId));
    } catch {}
  }
}
