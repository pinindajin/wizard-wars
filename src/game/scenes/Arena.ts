// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
import Phaser from "phaser"

import { WW_LOCAL_PLAYER_ID_REGISTRY_KEY } from "../constants"
import { GameConnection } from "../network/GameConnection"
import { PlayerRenderSystem } from "../ecs/systems/PlayerRenderSystem"
import {
  publishLoaderComplete,
  wireSceneLoaderProgress,
} from "../loaderStatus"
import { ArenaRuntime } from "./ArenaRuntime"
/* END-USER-IMPORTS */

export default class Arena extends Phaser.Scene {

	constructor() {
		super("Arena");

		/* START-USER-CTR-CODE */
		/* END-USER-CTR-CODE */
	}

	editorCreate(): void {

		// arenaMap
		this.cache.tilemap.add("arenaMap_arenaMap", {
			format: 1,
			data: {
				width: 21,
				height: 12,
				orientation: "orthogonal",
				tilewidth: 64,
				tileheight: 64,
				tilesets: [
					{
						columns: 16,
						margin: 0,
						spacing: 0,
						tilewidth: 64,
						tileheight: 64,
						tilecount: 16,
						firstgid: 1,
						image: "arena-terrain",
						name: "arena-terrain",
						imagewidth: 1024,
						imageheight: 64,
					},
				],
				layers: [
					{
						type: "tilelayer",
						name: "Ground",
						width: 21,
						height: 12,
						opacity: 1,
						data: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 2, 1, 1, 1, 7, 6, 1, 1, 1, 7, 1, 6, 7, 1, 1, 1, 6, 7, 2, 4, 4, 2, 6, 1, 1, 1, 7, 6, 1, 1, 1, 1, 1, 6, 7, 1, 1, 1, 6, 2, 4, 4, 2, 7, 6, 1, 1, 1, 7, 8, 8, 8, 8, 8, 1, 6, 7, 1, 1, 1, 2, 4, 4, 2, 1, 7, 6, 1, 1, 1, 8, 8, 8, 8, 8, 1, 1, 6, 7, 1, 1, 2, 4, 4, 2, 6, 7, 1, 1, 1, 6, 8, 8, 8, 8, 8, 1, 6, 1, 3, 3, 1, 2, 4, 4, 2, 1, 6, 7, 1, 1, 1, 8, 8, 8, 8, 8, 3, 1, 6, 1, 3, 3, 2, 4, 4, 2, 1, 1, 6, 7, 1, 1, 1, 6, 7, 6, 1, 3, 3, 1, 6, 1, 3, 2, 4, 4, 2, 1, 1, 1, 6, 7, 1, 1, 1, 6, 1, 6, 1, 3, 3, 1, 6, 1, 2, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
					},
				],
			},
		});
		const arenaMap = this.add.tilemap("arenaMap_arenaMap");
		arenaMap.addTilesetImage("arena-terrain");

		// Ground
		arenaMap.createLayer("Ground", ["arena-terrain"], 0, 0);

		// prop_mushroom_cluster
		this.add.image(1120, 224, "prop-mushroom-cluster");

		// prop_cracked_shield
		this.add.image(222, 288, "prop-cracked-shield");

		// prop_boulder_rock
		this.add.image(1229, 528, "prop-boulder-rock");

		// prop_mushroom_cluster_1
		this.add.image(221, 545, "prop-mushroom-cluster");

		this.arenaMap = arenaMap;

		this.events.emit("scene-awake");
	}

	private arenaMap!: Phaser.Tilemaps.Tilemap;

	/* START-USER-CODE */

	private runtime?: ArenaRuntime

	preload(): void {
		this.load.pack("arena-assets", "/assets/arena-asset-pack.json")
		wireSceneLoaderProgress(this, {
			scene: "Arena",
			description: "Arena assets",
		})
	}

	create(): void {
		this.editorCreate()
		this.runtime = new ArenaRuntime(this, {
			arenaMap: this.arenaMap,
		})
		this.runtime.start()
		publishLoaderComplete(this.game as unknown as Parameters<typeof publishLoaderComplete>[0])
	}

	update(time: number, delta: number): void {
		this.runtime?.update(time, delta)
	}

	/** Phaser group used to collect all player sprites for iteration. */
	get playerGroup(): Phaser.GameObjects.Group {
		return this.runtime?.playerGroup as Phaser.GameObjects.Group
	}

	/** Exposed for existing e2e diagnostics. */
	get playerRenderSystem(): PlayerRenderSystem | undefined {
		return this.runtime?.playerRenderSystem
	}

	getConnection(): GameConnection {
		return this.runtime?.getConnection() as GameConnection
	}

	getLocalPlayerId(): string | null {
		return (
			this.runtime?.getLocalPlayerId() ??
			((this.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as string | undefined) ?? null)
		)
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
