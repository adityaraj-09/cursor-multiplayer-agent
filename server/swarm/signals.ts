import { EventEmitter } from "events";

/**
 * In-process wakeups so board activity (human directives, spawns, phase
 * changes) schedules the next cycle immediately instead of on the next poll.
 */
class SwarmSignals extends EventEmitter {
  kick(swarmId: string): void {
    this.emit("kick", swarmId);
  }

  onKick(listener: (swarmId: string) => void): () => void {
    this.on("kick", listener);
    return () => this.off("kick", listener);
  }
}

export const swarmSignals = new SwarmSignals();
swarmSignals.setMaxListeners(50);
