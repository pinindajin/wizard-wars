// You can write more code here

/* START OF COMPILED CODE */

/* START-USER-IMPORTS */
import Phaser from "phaser"

import { ARENA_HEIGHT, ARENA_WIDTH } from "@/shared/balance-config/arena"
import { TILEMAP_DEPTH } from "@/shared/balance-config/rendering"
import type { MinimapCorner } from "@/shared/settings-config"
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

		// arena_base
		const arenaBase = this.add.image(0, 0, "arena-base");
		arenaBase.setOrigin(0, 0);
		arenaBase.setDepth(TILEMAP_DEPTH);

		// arenaProp0
		const arenaProp0 = this.add.image(132, 146, "arena-prop-brazier-tower");
		arenaProp0.setOrigin(0.5, 1);
		arenaProp0.setScale(0.24, 0.24);
		arenaProp0.setDepth(146);
		this.arenaProps.push(arenaProp0); // Brazier Tower

		// arenaProp1
		const arenaProp1 = this.add.image(225, 149, "arena-prop-brazier-tower");
		arenaProp1.setOrigin(0.5, 1);
		arenaProp1.setScale(0.24, 0.24);
		arenaProp1.setDepth(149);
		this.arenaProps.push(arenaProp1); // Brazier Tower

		// arenaProp2
		const arenaProp2 = this.add.image(72, 121, "arena-prop-brazier-tower");
		arenaProp2.setOrigin(0.5, 1);
		arenaProp2.setScale(0.23, 0.23);
		arenaProp2.setDepth(121);
		this.arenaProps.push(arenaProp2); // Brazier Tower

		// arenaProp3
		const arenaProp3 = this.add.image(1064, 146, "arena-prop-brazier-tower");
		arenaProp3.setOrigin(0.5, 1);
		arenaProp3.setScale(0.24, 0.24);
		arenaProp3.setDepth(146);
		this.arenaProps.push(arenaProp3); // Brazier Tower

		// arenaProp4
		const arenaProp4 = this.add.image(1195, 149, "arena-prop-brazier-tower");
		arenaProp4.setOrigin(0.5, 1);
		arenaProp4.setScale(0.24, 0.24);
		arenaProp4.setDepth(149);
		this.arenaProps.push(arenaProp4); // Brazier Tower

		// arenaProp5
		const arenaProp5 = this.add.image(1327, 121, "arena-prop-brazier-tower");
		arenaProp5.setOrigin(0.5, 1);
		arenaProp5.setScale(0.23, 0.23);
		arenaProp5.setDepth(121);
		this.arenaProps.push(arenaProp5); // Brazier Tower

		// arenaProp6
		const arenaProp6 = this.add.image(1326, 246, "arena-prop-tall-rune-pillar");
		arenaProp6.setOrigin(0.5, 1);
		arenaProp6.setScale(0.33, 0.33);
		arenaProp6.setDepth(246);
		this.arenaProps.push(arenaProp6); // Tall Rune Pillar

		// arenaProp7
		const arenaProp7 = this.add.image(1306, 427, "arena-prop-brazier-tower");
		arenaProp7.setOrigin(0.5, 1);
		arenaProp7.setScale(0.24, 0.24);
		arenaProp7.setDepth(427);
		this.arenaProps.push(arenaProp7); // Brazier Tower

		// arenaProp8
		const arenaProp8 = this.add.image(37, 427, "arena-prop-brazier-tower");
		arenaProp8.setOrigin(0.5, 1);
		arenaProp8.setScale(0.24, 0.24);
		arenaProp8.setDepth(427);
		this.arenaProps.push(arenaProp8); // Brazier Tower

		// arenaProp9
		const arenaProp9 = this.add.image(103, 382, "arena-prop-small-rocks");
		arenaProp9.setOrigin(0.5, 1);
		arenaProp9.setScale(0.36, 0.36);
		arenaProp9.setDepth(382);
		this.arenaProps.push(arenaProp9); // Small Rocks

		// arenaProp10
		const arenaProp10 = this.add.image(1260, 383, "arena-prop-basalt-cluster");
		arenaProp10.setOrigin(0.5, 1);
		arenaProp10.setScale(0.28, 0.28);
		arenaProp10.setDepth(383);
		this.arenaProps.push(arenaProp10); // Basalt Cluster

		// arenaProp11
		const arenaProp11 = this.add.image(459, 477, "arena-prop-medium-obelisk");
		arenaProp11.setOrigin(0.5, 1);
		arenaProp11.setScale(0.39, 0.39);
		arenaProp11.setDepth(477);
		this.arenaProps.push(arenaProp11); // Medium Obelisk

		// arenaProp12
		const arenaProp12 = this.add.image(613, 394, "arena-prop-medium-obelisk");
		arenaProp12.setOrigin(0.5, 1);
		arenaProp12.setScale(0.36, 0.36);
		arenaProp12.setDepth(394);
		this.arenaProps.push(arenaProp12); // Medium Obelisk

		// arenaProp13
		const arenaProp13 = this.add.image(806, 394, "arena-prop-medium-obelisk");
		arenaProp13.setOrigin(0.5, 1);
		arenaProp13.setScale(0.36, 0.36);
		arenaProp13.setDepth(394);
		this.arenaProps.push(arenaProp13); // Medium Obelisk

		// arenaProp14
		const arenaProp14 = this.add.image(1008, 563, "arena-prop-medium-obelisk");
		arenaProp14.setOrigin(0.5, 1);
		arenaProp14.setScale(0.39, 0.39);
		arenaProp14.setDepth(563);
		this.arenaProps.push(arenaProp14); // Medium Obelisk

		// arenaProp15
		const arenaProp15 = this.add.image(949, 723, "arena-prop-medium-obelisk");
		arenaProp15.setOrigin(0.5, 1);
		arenaProp15.setScale(0.37, 0.37);
		arenaProp15.setDepth(723);
		this.arenaProps.push(arenaProp15); // Medium Obelisk

		// arenaProp16
		const arenaProp16 = this.add.image(779, 781, "arena-prop-medium-obelisk");
		arenaProp16.setOrigin(0.5, 1);
		arenaProp16.setScale(0.36, 0.36);
		arenaProp16.setDepth(781);
		this.arenaProps.push(arenaProp16); // Medium Obelisk

		// arenaProp17
		const arenaProp17 = this.add.image(650, 781, "arena-prop-medium-obelisk");
		arenaProp17.setOrigin(0.5, 1);
		arenaProp17.setScale(0.36, 0.36);
		arenaProp17.setDepth(781);
		this.arenaProps.push(arenaProp17); // Medium Obelisk

		// arenaProp18
		const arenaProp18 = this.add.image(462, 706, "arena-prop-medium-obelisk");
		arenaProp18.setOrigin(0.5, 1);
		arenaProp18.setScale(0.37, 0.37);
		arenaProp18.setDepth(706);
		this.arenaProps.push(arenaProp18); // Medium Obelisk

		// arenaProp19
		const arenaProp19 = this.add.image(404, 588, "arena-prop-medium-obelisk");
		arenaProp19.setOrigin(0.5, 1);
		arenaProp19.setScale(0.37, 0.37);
		arenaProp19.setDepth(588);
		this.arenaProps.push(arenaProp19); // Medium Obelisk

		// arenaProp20
		const arenaProp20 = this.add.image(521, 588, "arena-prop-brazier-tower");
		arenaProp20.setOrigin(0.5, 1);
		arenaProp20.setScale(0.24, 0.24);
		arenaProp20.setDepth(588);
		this.arenaProps.push(arenaProp20); // Brazier Tower

		// arenaProp21
		const arenaProp21 = this.add.image(904, 588, "arena-prop-brazier-tower");
		arenaProp21.setOrigin(0.5, 1);
		arenaProp21.setScale(0.24, 0.24);
		arenaProp21.setDepth(588);
		this.arenaProps.push(arenaProp21); // Brazier Tower

		// arenaProp22
		const arenaProp22 = this.add.image(946, 423, "arena-prop-brazier-tower");
		arenaProp22.setOrigin(0.5, 1);
		arenaProp22.setScale(0.24, 0.24);
		arenaProp22.setDepth(423);
		this.arenaProps.push(arenaProp22); // Brazier Tower

		// arenaProp23
		const arenaProp23 = this.add.image(464, 423, "arena-prop-brazier-tower");
		arenaProp23.setOrigin(0.5, 1);
		arenaProp23.setScale(0.24, 0.24);
		arenaProp23.setDepth(423);
		this.arenaProps.push(arenaProp23); // Brazier Tower

		// arenaProp24
		const arenaProp24 = this.add.image(650, 209, "arena-prop-brazier-tower");
		arenaProp24.setOrigin(0.5, 1);
		arenaProp24.setScale(0.24, 0.24);
		arenaProp24.setDepth(209);
		this.arenaProps.push(arenaProp24); // Brazier Tower

		// arenaProp25
		const arenaProp25 = this.add.image(777, 209, "arena-prop-brazier-tower");
		arenaProp25.setOrigin(0.5, 1);
		arenaProp25.setScale(0.24, 0.24);
		arenaProp25.setDepth(209);
		this.arenaProps.push(arenaProp25); // Brazier Tower

		// arenaProp26
		const arenaProp26 = this.add.image(650, 874, "arena-prop-brazier-tower");
		arenaProp26.setOrigin(0.5, 1);
		arenaProp26.setScale(0.24, 0.24);
		arenaProp26.setDepth(874);
		this.arenaProps.push(arenaProp26); // Brazier Tower

		// arenaProp27
		const arenaProp27 = this.add.image(785, 874, "arena-prop-brazier-tower");
		arenaProp27.setOrigin(0.5, 1);
		arenaProp27.setScale(0.24, 0.24);
		arenaProp27.setDepth(874);
		this.arenaProps.push(arenaProp27); // Brazier Tower

		// arenaProp28
		const arenaProp28 = this.add.image(548, 445, "arena-prop-straight-wall");
		arenaProp28.setOrigin(0.5, 1);
		arenaProp28.setScale(0.32, 0.32);
		arenaProp28.setDepth(445);
		this.arenaProps.push(arenaProp28); // Straight Wall

		// arenaProp29
		const arenaProp29 = this.add.image(868, 445, "arena-prop-straight-wall");
		arenaProp29.setOrigin(0.5, 1);
		arenaProp29.setScale(0.32, 0.32);
		arenaProp29.setDepth(445);
		this.arenaProps.push(arenaProp29); // Straight Wall

		// arenaProp30
		const arenaProp30 = this.add.image(558, 676, "arena-prop-straight-wall");
		arenaProp30.setOrigin(0.5, 1);
		arenaProp30.setScale(0.31, 0.31);
		arenaProp30.setDepth(676);
		this.arenaProps.push(arenaProp30); // Straight Wall

		// arenaProp31
		const arenaProp31 = this.add.image(860, 676, "arena-prop-straight-wall");
		arenaProp31.setOrigin(0.5, 1);
		arenaProp31.setScale(0.31, 0.31);
		arenaProp31.setDepth(676);
		this.arenaProps.push(arenaProp31); // Straight Wall

		// arenaProp32
		const arenaProp32 = this.add.image(650, 560, "arena-prop-short-wall-slab");
		arenaProp32.setOrigin(0.5, 1);
		arenaProp32.setScale(0.33, 0.33);
		arenaProp32.setDepth(560);
		this.arenaProps.push(arenaProp32); // Short Wall Slab

		// arenaProp33
		const arenaProp33 = this.add.image(775, 560, "arena-prop-short-wall-slab");
		arenaProp33.setOrigin(0.5, 1);
		arenaProp33.setScale(-0.33, 0.33);
		arenaProp33.setDepth(560);
		this.arenaProps.push(arenaProp33); // Short Wall Slab

		// arenaProp34
		const arenaProp34 = this.add.image(392, 864, "arena-prop-brazier-tower");
		arenaProp34.setOrigin(0.5, 1);
		arenaProp34.setScale(0.24, 0.24);
		arenaProp34.setDepth(864);
		this.arenaProps.push(arenaProp34); // Brazier Tower

		// arenaProp35
		const arenaProp35 = this.add.image(1017, 864, "arena-prop-brazier-tower");
		arenaProp35.setOrigin(0.5, 1);
		arenaProp35.setScale(0.24, 0.24);
		arenaProp35.setDepth(864);
		this.arenaProps.push(arenaProp35); // Brazier Tower

		// arenaProp36
		const arenaProp36 = this.add.image(1296, 923, "arena-prop-brazier-tower");
		arenaProp36.setOrigin(0.5, 1);
		arenaProp36.setScale(0.24, 0.24);
		arenaProp36.setDepth(923);
		this.arenaProps.push(arenaProp36); // Brazier Tower

		// arenaProp37
		const arenaProp37 = this.add.image(106, 923, "arena-prop-brazier-tower");
		arenaProp37.setOrigin(0.5, 1);
		arenaProp37.setScale(0.24, 0.24);
		arenaProp37.setDepth(923);
		this.arenaProps.push(arenaProp37); // Brazier Tower

		// arenaProp38
		const arenaProp38 = this.add.image(164, 1008, "arena-prop-lava-spire-cluster");
		arenaProp38.setOrigin(0.5, 1);
		arenaProp38.setScale(0.28, 0.28);
		arenaProp38.setDepth(1008);
		this.arenaProps.push(arenaProp38); // Lava Spire Cluster

		// arenaProp39
		const arenaProp39 = this.add.image(1240, 1008, "arena-prop-lava-spire-cluster");
		arenaProp39.setOrigin(0.5, 1);
		arenaProp39.setScale(-0.28, 0.28);
		arenaProp39.setDepth(1008);
		this.arenaProps.push(arenaProp39); // Lava Spire Cluster

		this.arenaWidthPx = ARENA_WIDTH;
		this.arenaHeightPx = ARENA_HEIGHT;

		this.events.emit("scene-awake");
	}

	private arenaWidthPx = ARENA_WIDTH;
	private arenaHeightPx = ARENA_HEIGHT;
	private arenaProps: Phaser.GameObjects.Image[] = [];

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
			arenaWidthPx: this.arenaWidthPx,
			arenaHeightPx: this.arenaHeightPx,
		})
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.runtime?.destroy()
			this.runtime = undefined
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

	/** Applies user-facing audio volume settings to the active runtime. */
	setAudioVolumes(settings: {
		readonly bgmVolume?: number
		readonly sfxVolume?: number
	}): void {
		this.runtime?.setAudioVolumes(settings)
	}

	/** Applies local-only debug overlay mode to the active runtime. */
	setDebugModeEnabled(enabled: boolean): void {
		this.runtime?.setDebugModeEnabled(enabled)
	}

	/** Applies persisted minimap placement to the active runtime. */
	setMinimapCorner(corner: MinimapCorner): void {
		this.runtime?.setMinimapCorner(corner)
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
