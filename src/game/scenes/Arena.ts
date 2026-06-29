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
		// Arena.scene is a Phaser Editor data scene: it keeps editor-visible
		// rectangles for regions/colliders, but this runtime output only creates
		// the visual image layer and props. Region data is exported via arena.json.

		// arena_base
		const arenaBase = this.add.image(0, 0, "arena-base");
		arenaBase.setOrigin(0, 0);
		arenaBase.setDepth(TILEMAP_DEPTH);

		// arenaProp0
		const arenaProp0 = this.add.image(264, 172, "arena-prop-brazier-tower");
		arenaProp0.setOrigin(0.5, 1);
		arenaProp0.setScale(0.48, 0.48);
		arenaProp0.setDepth(172);
		this.arenaProps.push(arenaProp0); // Brazier Tower

		// arenaProp1
		const arenaProp1 = this.add.image(448, 192, "arena-prop-brazier-tower");
		arenaProp1.setOrigin(0.5, 1);
		arenaProp1.setScale(0.48, 0.48);
		arenaProp1.setDepth(192);
		this.arenaProps.push(arenaProp1); // Brazier Tower

		// arenaProp2
		const arenaProp2 = this.add.image(140, 268, "arena-prop-brazier-tower");
		arenaProp2.setOrigin(0.5, 1);
		arenaProp2.setScale(0.46, 0.46);
		arenaProp2.setDepth(268);
		this.arenaProps.push(arenaProp2); // Brazier Tower

		// arenaProp3
		const arenaProp3 = this.add.image(538, 396, "arena-prop-brazier-tower");
		arenaProp3.setOrigin(0.5, 1);
		arenaProp3.setScale(0.48, 0.48);
		arenaProp3.setDepth(396);
		this.arenaProps.push(arenaProp3); // Brazier Tower

		// arenaProp4
		const arenaProp4 = this.add.image(334, 492, "arena-prop-brazier-tower");
		arenaProp4.setOrigin(0.5, 1);
		arenaProp4.setScale(0.48, 0.48);
		arenaProp4.setDepth(492);
		this.arenaProps.push(arenaProp4); // Brazier Tower

		// arenaProp5
		const arenaProp5 = this.add.image(2128, 292, "arena-prop-brazier-tower");
		arenaProp5.setOrigin(0.5, 1);
		arenaProp5.setScale(0.48, 0.48);
		arenaProp5.setDepth(292);
		this.arenaProps.push(arenaProp5); // Brazier Tower

		// arenaProp6
		const arenaProp6 = this.add.image(2390, 298, "arena-prop-brazier-tower");
		arenaProp6.setOrigin(0.5, 1);
		arenaProp6.setScale(0.48, 0.48);
		arenaProp6.setDepth(298);
		this.arenaProps.push(arenaProp6); // Brazier Tower

		// arenaProp7
		const arenaProp7 = this.add.image(2654, 242, "arena-prop-brazier-tower");
		arenaProp7.setOrigin(0.5, 1);
		arenaProp7.setScale(0.46, 0.46);
		arenaProp7.setDepth(242);
		this.arenaProps.push(arenaProp7); // Brazier Tower

		// arenaProp8
		const arenaProp8 = this.add.image(2652, 492, "arena-prop-tall-rune-pillar");
		arenaProp8.setOrigin(0.5, 1);
		arenaProp8.setScale(0.66, 0.66);
		arenaProp8.setDepth(492);
		this.arenaProps.push(arenaProp8); // Tall Rune Pillar

		// arenaProp9
		const arenaProp9 = this.add.image(2612, 854, "arena-prop-brazier-tower");
		arenaProp9.setOrigin(0.5, 1);
		arenaProp9.setScale(0.48, 0.48);
		arenaProp9.setDepth(854);
		this.arenaProps.push(arenaProp9); // Brazier Tower

		// arenaProp10
		const arenaProp10 = this.add.image(74, 854, "arena-prop-brazier-tower");
		arenaProp10.setOrigin(0.5, 1);
		arenaProp10.setScale(0.48, 0.48);
		arenaProp10.setDepth(854);
		this.arenaProps.push(arenaProp10); // Brazier Tower

		// arenaProp11
		const arenaProp11 = this.add.image(206, 764, "arena-prop-small-rocks");
		arenaProp11.setOrigin(0.5, 1);
		arenaProp11.setScale(0.72, 0.72);
		arenaProp11.setDepth(764);
		this.arenaProps.push(arenaProp11); // Small Rocks

		// arenaProp12
		const arenaProp12 = this.add.image(2520, 766, "arena-prop-basalt-cluster");
		arenaProp12.setOrigin(0.5, 1);
		arenaProp12.setScale(0.56, 0.56);
		arenaProp12.setDepth(766);
		this.arenaProps.push(arenaProp12); // Basalt Cluster

		// arenaProp13
		const arenaProp13 = this.add.image(918, 954, "arena-prop-medium-obelisk");
		arenaProp13.setOrigin(0.5, 1);
		arenaProp13.setScale(0.78, 0.78);
		arenaProp13.setDepth(954);
		this.arenaProps.push(arenaProp13); // Medium Obelisk

		// arenaProp14
		const arenaProp14 = this.add.image(1226, 788, "arena-prop-medium-obelisk");
		arenaProp14.setOrigin(0.5, 1);
		arenaProp14.setScale(0.72, 0.72);
		arenaProp14.setDepth(788);
		this.arenaProps.push(arenaProp14); // Medium Obelisk

		// arenaProp15
		const arenaProp15 = this.add.image(1612, 788, "arena-prop-medium-obelisk");
		arenaProp15.setOrigin(0.5, 1);
		arenaProp15.setScale(0.72, 0.72);
		arenaProp15.setDepth(788);
		this.arenaProps.push(arenaProp15); // Medium Obelisk

		// arenaProp16
		const arenaProp16 = this.add.image(2016, 1126, "arena-prop-medium-obelisk");
		arenaProp16.setOrigin(0.5, 1);
		arenaProp16.setScale(0.78, 0.78);
		arenaProp16.setDepth(1126);
		this.arenaProps.push(arenaProp16); // Medium Obelisk

		// arenaProp17
		const arenaProp17 = this.add.image(1898, 1446, "arena-prop-medium-obelisk");
		arenaProp17.setOrigin(0.5, 1);
		arenaProp17.setScale(0.74, 0.74);
		arenaProp17.setDepth(1446);
		this.arenaProps.push(arenaProp17); // Medium Obelisk

		// arenaProp18
		const arenaProp18 = this.add.image(1558, 1562, "arena-prop-medium-obelisk");
		arenaProp18.setOrigin(0.5, 1);
		arenaProp18.setScale(0.72, 0.72);
		arenaProp18.setDepth(1562);
		this.arenaProps.push(arenaProp18); // Medium Obelisk

		// arenaProp19
		const arenaProp19 = this.add.image(1300, 1562, "arena-prop-medium-obelisk");
		arenaProp19.setOrigin(0.5, 1);
		arenaProp19.setScale(0.72, 0.72);
		arenaProp19.setDepth(1562);
		this.arenaProps.push(arenaProp19); // Medium Obelisk

		// arenaProp20
		const arenaProp20 = this.add.image(924, 1412, "arena-prop-medium-obelisk");
		arenaProp20.setOrigin(0.5, 1);
		arenaProp20.setScale(0.74, 0.74);
		arenaProp20.setDepth(1412);
		this.arenaProps.push(arenaProp20); // Medium Obelisk

		// arenaProp21
		const arenaProp21 = this.add.image(808, 1176, "arena-prop-medium-obelisk");
		arenaProp21.setOrigin(0.5, 1);
		arenaProp21.setScale(0.74, 0.74);
		arenaProp21.setDepth(1176);
		this.arenaProps.push(arenaProp21); // Medium Obelisk

		// arenaProp22
		const arenaProp22 = this.add.image(1042, 1176, "arena-prop-brazier-tower");
		arenaProp22.setOrigin(0.5, 1);
		arenaProp22.setScale(0.48, 0.48);
		arenaProp22.setDepth(1176);
		this.arenaProps.push(arenaProp22); // Brazier Tower

		// arenaProp23
		const arenaProp23 = this.add.image(1808, 1176, "arena-prop-brazier-tower");
		arenaProp23.setOrigin(0.5, 1);
		arenaProp23.setScale(0.48, 0.48);
		arenaProp23.setDepth(1176);
		this.arenaProps.push(arenaProp23); // Brazier Tower

		// arenaProp24
		const arenaProp24 = this.add.image(1892, 846, "arena-prop-brazier-tower");
		arenaProp24.setOrigin(0.5, 1);
		arenaProp24.setScale(0.48, 0.48);
		arenaProp24.setDepth(846);
		this.arenaProps.push(arenaProp24); // Brazier Tower

		// arenaProp25
		const arenaProp25 = this.add.image(928, 846, "arena-prop-brazier-tower");
		arenaProp25.setOrigin(0.5, 1);
		arenaProp25.setScale(0.48, 0.48);
		arenaProp25.setDepth(846);
		this.arenaProps.push(arenaProp25); // Brazier Tower

		// arenaProp26
		const arenaProp26 = this.add.image(1300, 418, "arena-prop-brazier-tower");
		arenaProp26.setOrigin(0.5, 1);
		arenaProp26.setScale(0.48, 0.48);
		arenaProp26.setDepth(418);
		this.arenaProps.push(arenaProp26); // Brazier Tower

		// arenaProp27
		const arenaProp27 = this.add.image(1554, 418, "arena-prop-brazier-tower");
		arenaProp27.setOrigin(0.5, 1);
		arenaProp27.setScale(0.48, 0.48);
		arenaProp27.setDepth(418);
		this.arenaProps.push(arenaProp27); // Brazier Tower

		// arenaProp28
		const arenaProp28 = this.add.image(1300, 1748, "arena-prop-brazier-tower");
		arenaProp28.setOrigin(0.5, 1);
		arenaProp28.setScale(0.48, 0.48);
		arenaProp28.setDepth(1748);
		this.arenaProps.push(arenaProp28); // Brazier Tower

		// arenaProp29
		const arenaProp29 = this.add.image(1570, 1748, "arena-prop-brazier-tower");
		arenaProp29.setOrigin(0.5, 1);
		arenaProp29.setScale(0.48, 0.48);
		arenaProp29.setDepth(1748);
		this.arenaProps.push(arenaProp29); // Brazier Tower

		// arenaProp30
		const arenaProp30 = this.add.image(1096, 890, "arena-prop-straight-wall");
		arenaProp30.setOrigin(0.5, 1);
		arenaProp30.setScale(0.64, 0.64);
		arenaProp30.setDepth(890);
		this.arenaProps.push(arenaProp30); // Straight Wall

		// arenaProp31
		const arenaProp31 = this.add.image(1736, 890, "arena-prop-straight-wall");
		arenaProp31.setOrigin(0.5, 1);
		arenaProp31.setScale(0.64, 0.64);
		arenaProp31.setDepth(890);
		this.arenaProps.push(arenaProp31); // Straight Wall

		// arenaProp32
		const arenaProp32 = this.add.image(1116, 1352, "arena-prop-straight-wall");
		arenaProp32.setOrigin(0.5, 1);
		arenaProp32.setScale(0.62, 0.62);
		arenaProp32.setDepth(1352);
		this.arenaProps.push(arenaProp32); // Straight Wall

		// arenaProp33
		const arenaProp33 = this.add.image(1720, 1352, "arena-prop-straight-wall");
		arenaProp33.setOrigin(0.5, 1);
		arenaProp33.setScale(0.62, 0.62);
		arenaProp33.setDepth(1352);
		this.arenaProps.push(arenaProp33); // Straight Wall

		// arenaProp34
		const arenaProp34 = this.add.image(1300, 1120, "arena-prop-short-wall-slab");
		arenaProp34.setOrigin(0.5, 1);
		arenaProp34.setScale(0.66, 0.66);
		arenaProp34.setDepth(1120);
		this.arenaProps.push(arenaProp34); // Short Wall Slab

		// arenaProp35
		const arenaProp35 = this.add.image(1550, 1120, "arena-prop-short-wall-slab");
		arenaProp35.setOrigin(0.5, 1);
		arenaProp35.setScale(-0.66, 0.66);
		arenaProp35.setDepth(1120);
		this.arenaProps.push(arenaProp35); // Short Wall Slab

		// arenaProp36
		const arenaProp36 = this.add.image(784, 1728, "arena-prop-brazier-tower");
		arenaProp36.setOrigin(0.5, 1);
		arenaProp36.setScale(0.48, 0.48);
		arenaProp36.setDepth(1728);
		this.arenaProps.push(arenaProp36); // Brazier Tower

		// arenaProp37
		const arenaProp37 = this.add.image(2034, 1728, "arena-prop-brazier-tower");
		arenaProp37.setOrigin(0.5, 1);
		arenaProp37.setScale(0.48, 0.48);
		arenaProp37.setDepth(1728);
		this.arenaProps.push(arenaProp37); // Brazier Tower

		// arenaProp38
		const arenaProp38 = this.add.image(2592, 1846, "arena-prop-brazier-tower");
		arenaProp38.setOrigin(0.5, 1);
		arenaProp38.setScale(0.48, 0.48);
		arenaProp38.setDepth(1846);
		this.arenaProps.push(arenaProp38); // Brazier Tower

		// arenaProp39
		const arenaProp39 = this.add.image(212, 1846, "arena-prop-brazier-tower");
		arenaProp39.setOrigin(0.5, 1);
		arenaProp39.setScale(0.48, 0.48);
		arenaProp39.setDepth(1846);
		this.arenaProps.push(arenaProp39); // Brazier Tower

		// arenaProp40
		const arenaProp40 = this.add.image(328, 2016, "arena-prop-lava-spire-cluster");
		arenaProp40.setOrigin(0.5, 1);
		arenaProp40.setScale(0.56, 0.56);
		arenaProp40.setDepth(2016);
		this.arenaProps.push(arenaProp40); // Lava Spire Cluster

		// arenaProp41
		const arenaProp41 = this.add.image(2480, 2016, "arena-prop-lava-spire-cluster");
		arenaProp41.setOrigin(0.5, 1);
		arenaProp41.setScale(-0.56, 0.56);
		arenaProp41.setDepth(2016);
		this.arenaProps.push(arenaProp41); // Lava Spire Cluster

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
