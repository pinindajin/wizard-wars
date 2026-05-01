/**
 * Deferred ECS mutation buffer for Wizard Wars.
 *
 * bitECS 0.4 does not support adding or removing entities while a query result
 * is being iterated.  Any system that needs to create or destroy entities
 * (fireball spawn, entity death cleanup, etc.) must enqueue the operation here
 * and it will be executed after all systems have finished for the tick.
 */
import { World, addEntity, removeEntity, addComponent, removeComponent } from "bitecs"

// ─── Types ────────────────────────────────────────────────────────────────

/** Creates a new entity and immediately calls setup with its ID. */
type AddEntityCmd = {
  type: "addEntity"
  /**
   * When present and returns true, no entity is created and `setup` is not run.
   * Evaluated in `execute()` after the tick's systems have run.
   */
  skipIf?: (world: World) => boolean
  setup: (eid: number) => void
}

/** Removes an entity from the world. */
type RemoveEntityCmd = {
  type: "removeEntity"
  eid: number
}

/** Adds a component to an existing entity. */
type AddComponentCmd = {
  type: "addComponent"
  eid: number
  component: object
}

/** Removes a component from an existing entity. */
type RemoveComponentCmd = {
  type: "removeComponent"
  eid: number
  component: object
}

export type BufferedCommand =
  | AddEntityCmd
  | RemoveEntityCmd
  | AddComponentCmd
  | RemoveComponentCmd

export type CommandBuffer = {
  /** Enqueue a mutation to be applied at the end of the current tick. */
  enqueue: (cmd: BufferedCommand) => void
  /** Execute all queued commands in order, then clear the queue. */
  execute: (world: World) => void
  /** Discard all queued commands without executing them. */
  clear: () => void
}

// ─── Factory ─────────────────────────────────────────────────────────────

/**
 * Creates a new CommandBuffer with an empty queue.
 *
 * @returns A fresh CommandBuffer ready to accept commands.
 */
export function createCommandBuffer(): CommandBuffer {
  const queue: BufferedCommand[] = []

  return {
    enqueue(cmd) {
      queue.push(cmd)
    },

    execute(world) {
      for (const cmd of queue) {
        switch (cmd.type) {
          case "addEntity": {
            if (cmd.skipIf?.(world)) break
            const eid = addEntity(world)
            cmd.setup(eid)
            break
          }
          case "removeEntity":
            removeEntity(world, cmd.eid)
            break
          case "addComponent":
            addComponent(world, cmd.eid, cmd.component)
            break
          case "removeComponent":
            removeComponent(world, cmd.eid, cmd.component)
            break
        }
      }
      queue.length = 0
    },

    clear() {
      queue.length = 0
    },
  }
}
