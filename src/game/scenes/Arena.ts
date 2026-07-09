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
		const arenaProp0 = this.add.image(1459.5, 193, "arena-prop-instance-000");
		arenaProp0.setOrigin(0.5, 1);
		arenaProp0.setDepth(193);
		this.arenaProps.push(arenaProp0);

		// arenaProp1
		const arenaProp1 = this.add.image(304.5, 216, "arena-prop-instance-001");
		arenaProp1.setOrigin(0.5, 1);
		arenaProp1.setDepth(216);
		this.arenaProps.push(arenaProp1);

		// arenaProp2
		const arenaProp2 = this.add.image(559.5, 215, "arena-prop-instance-002");
		arenaProp2.setOrigin(0.5, 1);
		arenaProp2.setDepth(215);
		this.arenaProps.push(arenaProp2);

		// arenaProp3
		const arenaProp3 = this.add.image(1518.5, 275, "arena-prop-instance-003");
		arenaProp3.setOrigin(0.5, 1);
		arenaProp3.setDepth(275);
		this.arenaProps.push(arenaProp3);

		// arenaProp4
		const arenaProp4 = this.add.image(453.5, 328, "arena-prop-instance-004");
		arenaProp4.setOrigin(0.5, 1);
		arenaProp4.setDepth(328);
		this.arenaProps.push(arenaProp4);

		// arenaProp5
		const arenaProp5 = this.add.image(1639.5, 388, "arena-prop-instance-005");
		arenaProp5.setOrigin(0.5, 1);
		arenaProp5.setDepth(388);
		this.arenaProps.push(arenaProp5);

		// arenaProp6
		const arenaProp6 = this.add.image(379, 433, "arena-prop-instance-006");
		arenaProp6.setOrigin(0.5, 1);
		arenaProp6.setDepth(433);
		this.arenaProps.push(arenaProp6);

		// arenaProp7
		const arenaProp7 = this.add.image(625, 545, "arena-prop-instance-007");
		arenaProp7.setOrigin(0.5, 1);
		arenaProp7.setDepth(545);
		this.arenaProps.push(arenaProp7);

		// arenaProp8
		const arenaProp8 = this.add.image(1260, 598, "arena-prop-instance-008");
		arenaProp8.setOrigin(0.5, 1);
		arenaProp8.setDepth(598);
		this.arenaProps.push(arenaProp8);

		// arenaProp9
		const arenaProp9 = this.add.image(1354, 411, "arena-prop-instance-009");
		arenaProp9.setOrigin(0.5, 1);
		arenaProp9.setDepth(411);
		this.arenaProps.push(arenaProp9);

		// arenaProp10
		const arenaProp10 = this.add.image(755, 410, "arena-prop-instance-010");
		arenaProp10.setOrigin(0.5, 1);
		arenaProp10.setDepth(410);
		this.arenaProps.push(arenaProp10);

		// arenaProp11
		const arenaProp11 = this.add.image(1062, 463, "arena-prop-instance-011");
		arenaProp11.setOrigin(0.5, 1);
		arenaProp11.setDepth(463);
		this.arenaProps.push(arenaProp11);

		// arenaProp12
		const arenaProp12 = this.add.image(1428.5, 404, "arena-prop-instance-012");
		arenaProp12.setOrigin(0.5, 1);
		arenaProp12.setDepth(404);
		this.arenaProps.push(arenaProp12);

		// arenaProp13
		const arenaProp13 = this.add.image(799.5, 494, "arena-prop-instance-013");
		arenaProp13.setOrigin(0.5, 1);
		arenaProp13.setDepth(494);
		this.arenaProps.push(arenaProp13);

		// arenaProp14
		const arenaProp14 = this.add.image(905, 487, "arena-prop-instance-014");
		arenaProp14.setOrigin(0.5, 1);
		arenaProp14.setDepth(487);
		this.arenaProps.push(arenaProp14);

		// arenaProp15
		const arenaProp15 = this.add.image(1204.5, 487, "arena-prop-instance-015");
		arenaProp15.setOrigin(0.5, 1);
		arenaProp15.setDepth(487);
		this.arenaProps.push(arenaProp15);

		// arenaProp16
		const arenaProp16 = this.add.image(753.5, 517, "arena-prop-instance-016");
		arenaProp16.setOrigin(0.5, 1);
		arenaProp16.setDepth(517);
		this.arenaProps.push(arenaProp16);

		// arenaProp17
		const arenaProp17 = this.add.image(1155, 547, "arena-prop-instance-017");
		arenaProp17.setOrigin(0.5, 1);
		arenaProp17.setDepth(547);
		this.arenaProps.push(arenaProp17);

		// arenaProp18
		const arenaProp18 = this.add.image(934, 546, "arena-prop-instance-018");
		arenaProp18.setOrigin(0.5, 1);
		arenaProp18.setDepth(546);
		this.arenaProps.push(arenaProp18);

		// arenaProp19
		const arenaProp19 = this.add.image(1398.5, 539, "arena-prop-instance-019");
		arenaProp19.setOrigin(0.5, 1);
		arenaProp19.setDepth(539);
		this.arenaProps.push(arenaProp19);

		// arenaProp20
		const arenaProp20 = this.add.image(828.5, 598, "arena-prop-instance-020");
		arenaProp20.setOrigin(0.5, 1);
		arenaProp20.setDepth(598);
		this.arenaProps.push(arenaProp20);

		// arenaProp21
		const arenaProp21 = this.add.image(1045, 591, "arena-prop-instance-021");
		arenaProp21.setOrigin(0.5, 1);
		arenaProp21.setDepth(591);
		this.arenaProps.push(arenaProp21);

		// arenaProp22
		const arenaProp22 = this.add.image(888, 725, "arena-prop-instance-022");
		arenaProp22.setOrigin(0.5, 1);
		arenaProp22.setDepth(725);
		this.arenaProps.push(arenaProp22);

		// arenaProp23
		const arenaProp23 = this.add.image(1185, 725, "arena-prop-instance-023");
		arenaProp23.setOrigin(0.5, 1);
		arenaProp23.setDepth(725);
		this.arenaProps.push(arenaProp23);

		// arenaProp24
		const arenaProp24 = this.add.image(408.5, 712, "arena-prop-instance-024");
		arenaProp24.setOrigin(0.5, 1);
		arenaProp24.setDepth(712);
		this.arenaProps.push(arenaProp24);

		// arenaProp25
		const arenaProp25 = this.add.image(275, 763, "arena-prop-instance-025");
		arenaProp25.setOrigin(0.5, 1);
		arenaProp25.setDepth(763);
		this.arenaProps.push(arenaProp25);

		// arenaProp26
		const arenaProp26 = this.add.image(162, 704, "arena-prop-instance-026");
		arenaProp26.setOrigin(0.5, 1);
		arenaProp26.setDepth(704);
		this.arenaProps.push(arenaProp26);

		// arenaProp27
		const arenaProp27 = this.add.image(1458.5, 734, "arena-prop-instance-027");
		arenaProp27.setOrigin(0.5, 1);
		arenaProp27.setDepth(734);
		this.arenaProps.push(arenaProp27);

		// arenaProp28
		const arenaProp28 = this.add.image(687, 719, "arena-prop-instance-028");
		arenaProp28.setOrigin(0.5, 1);
		arenaProp28.setDepth(719);
		this.arenaProps.push(arenaProp28);

		// arenaProp29
		const arenaProp29 = this.add.image(1331.5, 830, "arena-prop-instance-029");
		arenaProp29.setOrigin(0.5, 1);
		arenaProp29.setDepth(830);
		this.arenaProps.push(arenaProp29);

		// arenaProp30
		const arenaProp30 = this.add.image(784, 794, "arena-prop-instance-030");
		arenaProp30.setOrigin(0.5, 1);
		arenaProp30.setDepth(794);
		this.arenaProps.push(arenaProp30);

		// arenaProp31
		const arenaProp31 = this.add.image(1752.5, 883, "arena-prop-instance-031");
		arenaProp31.setOrigin(0.5, 1);
		arenaProp31.setDepth(883);
		this.arenaProps.push(arenaProp31);

		// arenaProp32
		const arenaProp32 = this.add.image(678.5, 838, "arena-prop-instance-032");
		arenaProp32.setOrigin(0.5, 1);
		arenaProp32.setDepth(838);
		this.arenaProps.push(arenaProp32);

		// arenaProp33
		const arenaProp33 = this.add.image(319, 808, "arena-prop-instance-033");
		arenaProp33.setOrigin(0.5, 1);
		arenaProp33.setDepth(808);
		this.arenaProps.push(arenaProp33);

		// arenaProp34
		const arenaProp34 = this.add.image(580.5, 931, "arena-prop-instance-034");
		arenaProp34.setOrigin(0.5, 1);
		arenaProp34.setDepth(931);
		this.arenaProps.push(arenaProp34);

		// arenaProp35
		const arenaProp35 = this.add.image(1909, 854, "arena-prop-instance-035");
		arenaProp35.setOrigin(0.5, 1);
		arenaProp35.setDepth(854);
		this.arenaProps.push(arenaProp35);

		// arenaProp36
		const arenaProp36 = this.add.image(184.5, 869, "arena-prop-instance-036");
		arenaProp36.setOrigin(0.5, 1);
		arenaProp36.setDepth(869);
		this.arenaProps.push(arenaProp36);

		// arenaProp37
		const arenaProp37 = this.add.image(1414.5, 943, "arena-prop-instance-037");
		arenaProp37.setOrigin(0.5, 1);
		arenaProp37.setDepth(943);
		this.arenaProps.push(arenaProp37);

		// arenaProp38
		const arenaProp38 = this.add.image(904.5, 869, "arena-prop-instance-038");
		arenaProp38.setOrigin(0.5, 1);
		arenaProp38.setDepth(869);
		this.arenaProps.push(arenaProp38);

		// arenaProp39
		const arenaProp39 = this.add.image(1174.5, 884, "arena-prop-instance-039");
		arenaProp39.setOrigin(0.5, 1);
		arenaProp39.setDepth(884);
		this.arenaProps.push(arenaProp39);

		// arenaProp40
		const arenaProp40 = this.add.image(334, 943, "arena-prop-instance-040");
		arenaProp40.setOrigin(0.5, 1);
		arenaProp40.setDepth(943);
		this.arenaProps.push(arenaProp40);

		// arenaProp41
		const arenaProp41 = this.add.image(821.5, 965, "arena-prop-instance-041");
		arenaProp41.setOrigin(0.5, 1);
		arenaProp41.setDepth(965);
		this.arenaProps.push(arenaProp41);

		// arenaProp42
		const arenaProp42 = this.add.image(1061, 936, "arena-prop-instance-042");
		arenaProp42.setOrigin(0.5, 1);
		arenaProp42.setDepth(936);
		this.arenaProps.push(arenaProp42);

		// arenaProp43
		const arenaProp43 = this.add.image(1233.5, 973, "arena-prop-instance-043");
		arenaProp43.setOrigin(0.5, 1);
		arenaProp43.setDepth(973);
		this.arenaProps.push(arenaProp43);

		// arenaProp44
		const arenaProp44 = this.add.image(1819.5, 1019, "arena-prop-instance-044");
		arenaProp44.setOrigin(0.5, 1);
		arenaProp44.setDepth(1019);
		this.arenaProps.push(arenaProp44);

		// arenaProp45
		const arenaProp45 = this.add.image(1055, 989, "arena-prop-instance-045");
		arenaProp45.setOrigin(0.5, 1);
		arenaProp45.setDepth(989);
		this.arenaProps.push(arenaProp45);

		// arenaProp46
		const arenaProp46 = this.add.image(1742, 1051, "arena-prop-instance-046");
		arenaProp46.setOrigin(0.5, 1);
		arenaProp46.setDepth(1051);
		this.arenaProps.push(arenaProp46);

		// arenaProp47
		const arenaProp47 = this.add.image(888.5, 1115, "arena-prop-instance-047");
		arenaProp47.setOrigin(0.5, 1);
		arenaProp47.setDepth(1115);
		this.arenaProps.push(arenaProp47);

		// arenaProp48
		const arenaProp48 = this.add.image(1188.5, 1115, "arena-prop-instance-048");
		arenaProp48.setOrigin(0.5, 1);
		arenaProp48.setDepth(1115);
		this.arenaProps.push(arenaProp48);

		// arenaProp49
		const arenaProp49 = this.add.image(605, 1072, "arena-prop-instance-049");
		arenaProp49.setOrigin(0.5, 1);
		arenaProp49.setDepth(1072);
		this.arenaProps.push(arenaProp49);

		// arenaProp50
		const arenaProp50 = this.add.image(1518.5, 1072, "arena-prop-instance-050");
		arenaProp50.setOrigin(0.5, 1);
		arenaProp50.setDepth(1072);
		this.arenaProps.push(arenaProp50);

		// arenaProp51
		const arenaProp51 = this.add.image(784, 1093, "arena-prop-instance-051");
		arenaProp51.setOrigin(0.5, 1);
		arenaProp51.setDepth(1093);
		this.arenaProps.push(arenaProp51);

		// arenaProp52
		const arenaProp52 = this.add.image(1324, 1093, "arena-prop-instance-052");
		arenaProp52.setOrigin(0.5, 1);
		arenaProp52.setDepth(1093);
		this.arenaProps.push(arenaProp52);

		// arenaProp53
		const arenaProp53 = this.add.image(559.5, 1094, "arena-prop-instance-053");
		arenaProp53.setOrigin(0.5, 1);
		arenaProp53.setDepth(1094);
		this.arenaProps.push(arenaProp53);

		// arenaProp54
		const arenaProp54 = this.add.image(1369, 1154, "arena-prop-instance-054");
		arenaProp54.setOrigin(0.5, 1);
		arenaProp54.setDepth(1154);
		this.arenaProps.push(arenaProp54);

		// arenaProp55
		const arenaProp55 = this.add.image(1789.5, 1177, "arena-prop-instance-055");
		arenaProp55.setOrigin(0.5, 1);
		arenaProp55.setDepth(1177);
		this.arenaProps.push(arenaProp55);

		// arenaProp56
		const arenaProp56 = this.add.image(717, 1154, "arena-prop-instance-056");
		arenaProp56.setOrigin(0.5, 1);
		arenaProp56.setDepth(1154);
		this.arenaProps.push(arenaProp56);

		// arenaProp57
		const arenaProp57 = this.add.image(1639, 1243, "arena-prop-instance-057");
		arenaProp57.setOrigin(0.5, 1);
		arenaProp57.setDepth(1243);
		this.arenaProps.push(arenaProp57);

		// arenaProp58
		const arenaProp58 = this.add.image(258.5, 1229, "arena-prop-instance-058");
		arenaProp58.setOrigin(0.5, 1);
		arenaProp58.setDepth(1229);
		this.arenaProps.push(arenaProp58);

		// arenaProp59
		const arenaProp59 = this.add.image(1189.5, 1265, "arena-prop-instance-059");
		arenaProp59.setOrigin(0.5, 1);
		arenaProp59.setDepth(1265);
		this.arenaProps.push(arenaProp59);

		// arenaProp60
		const arenaProp60 = this.add.image(1054, 1224, "arena-prop-instance-060");
		arenaProp60.setOrigin(0.5, 1);
		arenaProp60.setDepth(1224);
		this.arenaProps.push(arenaProp60);

		// arenaProp61
		const arenaProp61 = this.add.image(492.5, 1355, "arena-prop-instance-061");
		arenaProp61.setOrigin(0.5, 1);
		arenaProp61.setDepth(1355);
		this.arenaProps.push(arenaProp61);

		// arenaProp62
		const arenaProp62 = this.add.image(1041.5, 1423, "arena-prop-instance-062");
		arenaProp62.setOrigin(0.5, 1);
		arenaProp62.setDepth(1423);
		this.arenaProps.push(arenaProp62);

		// arenaProp63
		const arenaProp63 = this.add.image(1143.5, 1364, "arena-prop-instance-063");
		arenaProp63.setOrigin(0.5, 1);
		arenaProp63.setDepth(1364);
		this.arenaProps.push(arenaProp63);

		// arenaProp64
		const arenaProp64 = this.add.image(1454, 1319, "arena-prop-instance-064");
		arenaProp64.setOrigin(0.5, 1);
		arenaProp64.setDepth(1319);
		this.arenaProps.push(arenaProp64);

		// arenaProp65
		const arenaProp65 = this.add.image(963.5, 1363, "arena-prop-instance-065");
		arenaProp65.setOrigin(0.5, 1);
		arenaProp65.setDepth(1363);
		this.arenaProps.push(arenaProp65);

		// arenaProp66
		const arenaProp66 = this.add.image(1849.5, 1402, "arena-prop-instance-066");
		arenaProp66.setOrigin(0.5, 1);
		arenaProp66.setDepth(1402);
		this.arenaProps.push(arenaProp66);

		// arenaProp67
		const arenaProp67 = this.add.image(1684.5, 1394, "arena-prop-instance-067");
		arenaProp67.setOrigin(0.5, 1);
		arenaProp67.setDepth(1394);
		this.arenaProps.push(arenaProp67);

		// arenaProp68
		const arenaProp68 = this.add.image(393.5, 1394, "arena-prop-instance-068");
		arenaProp68.setOrigin(0.5, 1);
		arenaProp68.setDepth(1394);
		this.arenaProps.push(arenaProp68);

		// arenaProp69
		const arenaProp69 = this.add.image(979.5, 1469, "arena-prop-instance-069");
		arenaProp69.setOrigin(0.5, 1);
		arenaProp69.setDepth(1469);
		this.arenaProps.push(arenaProp69);

		// arenaProp70
		const arenaProp70 = this.add.image(461.5, 1521, "arena-prop-instance-070");
		arenaProp70.setOrigin(0.5, 1);
		arenaProp70.setDepth(1521);
		this.arenaProps.push(arenaProp70);

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
