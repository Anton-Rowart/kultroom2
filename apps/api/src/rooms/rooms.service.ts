import { Injectable, NotFoundException } from "@nestjs/common";
import { randomInt } from "node:crypto";

export type Participant = {
  id: string;
  socketId?: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  position: number;
  status: "playing" | "paused";
  ping: number;
};
export type Room = {
  id: string;
  movieId: string;
  hostId: string;
  createdAt: number;
  participants: Map<string, Participant>;
  playback: {
    position: number;
    status: "playing" | "paused";
    updatedAt: number;
    actorId: string;
  };
};

@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, Room>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();

  create(movieId: string, hostId: string) {
    let id = "";
    do {
      id = String(randomInt(100000, 1000000));
    } while (this.rooms.has(id));
    const room: Room = {
      id,
      movieId,
      hostId,
      createdAt: Date.now(),
      participants: new Map(),
      playback: {
        position: 0,
        status: "paused",
        updatedAt: Date.now(),
        actorId: hostId,
      },
    };
    this.rooms.set(id, room);
    return { id, movieId };
  }

  get(id: string) {
    const room = this.rooms.get(id);
    if (!room) throw new NotFoundException("Комната завершена");
    return room;
  }
  summary(id: string) {
    const room = this.get(id);
    return {
      id: room.id,
      movieId: room.movieId,
      hostId: room.hostId,
      playback: room.playback,
      participants: [...room.participants.values()].map(
        ({ socketId: _, ...p }) => p,
      ),
    };
  }
  join(
    roomId: string,
    user: Omit<
      Participant,
      "joinedAt" | "position" | "status" | "ping" | "isHost"
    >,
  ) {
    const room = this.get(roomId);
    const cleanup = this.cleanupTimers.get(roomId);
    if (cleanup) {
      clearTimeout(cleanup);
      this.cleanupTimers.delete(roomId);
    }
    if (!room.participants.has(user.id) && room.participants.size >= 10)
      throw new Error("В комнате уже 10 участников");
    room.participants.set(user.id, {
      ...user,
      isHost: room.hostId === user.id,
      joinedAt: Date.now(),
      position: room.playback.position,
      status: room.playback.status,
      ping: 0,
    });
    return room;
  }
  leave(socketId: string) {
    for (const room of this.rooms.values())
      for (const [id, user] of room.participants)
        if (user.socketId === socketId) {
          room.participants.delete(id);
          if (!room.participants.size) {
            const timer = setTimeout(() => {
              if (!room.participants.size) this.rooms.delete(room.id);
              this.cleanupTimers.delete(room.id);
            }, 30 * 60_000);
            timer.unref();
            this.cleanupTimers.set(room.id, timer);
          }
          return room.id;
        }
  }
}
