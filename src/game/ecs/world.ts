/**
 * Lightweight client-side ECS world.
 * Stores per-entity data as plain Record maps indexed by entity id (number).
 * No archetype or structural overhead — suitable for the small entity counts in Wizard Wars.
 */

/** All live entity ids currently tracked by the client. */
export const clientEntities: Set<number> = new Set()

/**
 * Registers a new entity in the world.
 *
 * @param id - The entity id (matches server bitECS entity id).
 */
export const addEntity = (id: number): void => {
  clientEntities.add(id)
}

/**
 * Removes an entity from the world and cleans up all component records.
 * Components themselves must be deleted by the caller (or each system on removal).
 *
 * @param id - The entity id to remove.
 */
export const removeEntity = (id: number): void => {
  clientEntities.delete(id)
}

/**
 * Returns true if the entity is currently tracked by this world.
 *
 * @param id - Entity id to test.
 * @returns Whether the entity exists.
 */
export const hasEntity = (id: number): boolean => clientEntities.has(id)
