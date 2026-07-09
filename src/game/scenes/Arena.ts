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
		const arenaProp0 = this.add.image(2919, 376, "arena-prop-instance-000");
		arenaProp0.setOrigin(0.5, 1);
		arenaProp0.setDepth(376);
		this.arenaProps.push(arenaProp0);

		// arenaProp1
		const arenaProp1 = this.add.image(610.5, 424, "arena-prop-instance-001");
		arenaProp1.setOrigin(0.5, 1);
		arenaProp1.setDepth(424);
		this.arenaProps.push(arenaProp1);

		// arenaProp2
		const arenaProp2 = this.add.image(1119, 421, "arena-prop-instance-002");
		arenaProp2.setOrigin(0.5, 1);
		arenaProp2.setDepth(421);
		this.arenaProps.push(arenaProp2);

		// arenaProp3
		const arenaProp3 = this.add.image(3037.5, 541, "arena-prop-instance-003");
		arenaProp3.setOrigin(0.5, 1);
		arenaProp3.setDepth(541);
		this.arenaProps.push(arenaProp3);

		// arenaProp4
		const arenaProp4 = this.add.image(907.5, 646, "arena-prop-instance-004");
		arenaProp4.setOrigin(0.5, 1);
		arenaProp4.setDepth(646);
		this.arenaProps.push(arenaProp4);

		// arenaProp5
		const arenaProp5 = this.add.image(3279, 766, "arena-prop-instance-005");
		arenaProp5.setOrigin(0.5, 1);
		arenaProp5.setDepth(766);
		this.arenaProps.push(arenaProp5);

		// arenaProp6
		const arenaProp6 = this.add.image(729, 679, "arena-prop-instance-006");
		arenaProp6.setOrigin(0.5, 1);
		arenaProp6.setDepth(679);
		this.arenaProps.push(arenaProp6);

		// arenaProp7
		const arenaProp7 = this.add.image(757.5, 856, "arena-prop-instance-007");
		arenaProp7.setOrigin(0.5, 1);
		arenaProp7.setDepth(856);
		this.arenaProps.push(arenaProp7);

		// arenaProp8
		const arenaProp8 = this.add.image(1249.5, 1081, "arena-prop-instance-008");
		arenaProp8.setOrigin(0.5, 1);
		arenaProp8.setDepth(1081);
		this.arenaProps.push(arenaProp8);

		// arenaProp9
		const arenaProp9 = this.add.image(2520, 1186, "arena-prop-instance-009");
		arenaProp9.setOrigin(0.5, 1);
		arenaProp9.setDepth(1186);
		this.arenaProps.push(arenaProp9);

		// arenaProp10
		const arenaProp10 = this.add.image(2707.5, 811, "arena-prop-instance-010");
		arenaProp10.setOrigin(0.5, 1);
		arenaProp10.setDepth(811);
		this.arenaProps.push(arenaProp10);

		// arenaProp11
		const arenaProp11 = this.add.image(1509, 811, "arena-prop-instance-011");
		arenaProp11.setOrigin(0.5, 1);
		arenaProp11.setDepth(811);
		this.arenaProps.push(arenaProp11);

		// arenaProp12
		const arenaProp12 = this.add.image(2124, 916, "arena-prop-instance-012");
		arenaProp12.setOrigin(0.5, 1);
		arenaProp12.setDepth(916);
		this.arenaProps.push(arenaProp12);

		// arenaProp13
		const arenaProp13 = this.add.image(2857.5, 799, "arena-prop-instance-013");
		arenaProp13.setOrigin(0.5, 1);
		arenaProp13.setDepth(799);
		this.arenaProps.push(arenaProp13);

		// arenaProp14
		const arenaProp14 = this.add.image(1599, 979, "arena-prop-instance-014");
		arenaProp14.setOrigin(0.5, 1);
		arenaProp14.setDepth(979);
		this.arenaProps.push(arenaProp14);

		// arenaProp15
		const arenaProp15 = this.add.image(1809, 964, "arena-prop-instance-015");
		arenaProp15.setOrigin(0.5, 1);
		arenaProp15.setDepth(964);
		this.arenaProps.push(arenaProp15);

		// arenaProp16
		const arenaProp16 = this.add.image(2409, 964, "arena-prop-instance-016");
		arenaProp16.setOrigin(0.5, 1);
		arenaProp16.setDepth(964);
		this.arenaProps.push(arenaProp16);

		// arenaProp17
		const arenaProp17 = this.add.image(1507.5, 1024, "arena-prop-instance-017");
		arenaProp17.setOrigin(0.5, 1);
		arenaProp17.setDepth(1024);
		this.arenaProps.push(arenaProp17);

		// arenaProp18
		const arenaProp18 = this.add.image(2310, 1084, "arena-prop-instance-018");
		arenaProp18.setOrigin(0.5, 1);
		arenaProp18.setDepth(1084);
		this.arenaProps.push(arenaProp18);

		// arenaProp19
		const arenaProp19 = this.add.image(1867.5, 1084, "arena-prop-instance-019");
		arenaProp19.setOrigin(0.5, 1);
		arenaProp19.setDepth(1084);
		this.arenaProps.push(arenaProp19);

		// arenaProp20
		const arenaProp20 = this.add.image(2797.5, 1069, "arena-prop-instance-020");
		arenaProp20.setOrigin(0.5, 1);
		arenaProp20.setDepth(1069);
		this.arenaProps.push(arenaProp20);

		// arenaProp21
		const arenaProp21 = this.add.image(1657.5, 1186, "arena-prop-instance-021");
		arenaProp21.setOrigin(0.5, 1);
		arenaProp21.setDepth(1186);
		this.arenaProps.push(arenaProp21);

		// arenaProp22
		const arenaProp22 = this.add.image(2089.5, 1171, "arena-prop-instance-022");
		arenaProp22.setOrigin(0.5, 1);
		arenaProp22.setDepth(1171);
		this.arenaProps.push(arenaProp22);

		// arenaProp23
		const arenaProp23 = this.add.image(1776, 1441, "arena-prop-instance-023");
		arenaProp23.setOrigin(0.5, 1);
		arenaProp23.setDepth(1441);
		this.arenaProps.push(arenaProp23);

		// arenaProp24
		const arenaProp24 = this.add.image(2370, 1441, "arena-prop-instance-024");
		arenaProp24.setOrigin(0.5, 1);
		arenaProp24.setDepth(1441);
		this.arenaProps.push(arenaProp24);

		// arenaProp25
		const arenaProp25 = this.add.image(817.5, 1414, "arena-prop-instance-025");
		arenaProp25.setOrigin(0.5, 1);
		arenaProp25.setDepth(1414);
		this.arenaProps.push(arenaProp25);

		// arenaProp26
		const arenaProp26 = this.add.image(549, 1516, "arena-prop-instance-026");
		arenaProp26.setOrigin(0.5, 1);
		arenaProp26.setDepth(1516);
		this.arenaProps.push(arenaProp26);

		// arenaProp27
		const arenaProp27 = this.add.image(324, 1399, "arena-prop-instance-027");
		arenaProp27.setOrigin(0.5, 1);
		arenaProp27.setDepth(1399);
		this.arenaProps.push(arenaProp27);

		// arenaProp28
		const arenaProp28 = this.add.image(2917.5, 1459, "arena-prop-instance-028");
		arenaProp28.setOrigin(0.5, 1);
		arenaProp28.setDepth(1459);
		this.arenaProps.push(arenaProp28);

		// arenaProp29
		const arenaProp29 = this.add.image(1374, 1429, "arena-prop-instance-029");
		arenaProp29.setOrigin(0.5, 1);
		arenaProp29.setDepth(1429);
		this.arenaProps.push(arenaProp29);

		// arenaProp30
		const arenaProp30 = this.add.image(2662.5, 1651, "arena-prop-instance-030");
		arenaProp30.setOrigin(0.5, 1);
		arenaProp30.setDepth(1651);
		this.arenaProps.push(arenaProp30);

		// arenaProp31
		const arenaProp31 = this.add.image(1567.5, 1579, "arena-prop-instance-031");
		arenaProp31.setOrigin(0.5, 1);
		arenaProp31.setDepth(1579);
		this.arenaProps.push(arenaProp31);

		// arenaProp32
		const arenaProp32 = this.add.image(3505.5, 1756, "arena-prop-instance-032");
		arenaProp32.setOrigin(0.5, 1);
		arenaProp32.setDepth(1756);
		this.arenaProps.push(arenaProp32);

		// arenaProp33
		const arenaProp33 = this.add.image(1357.5, 1666, "arena-prop-instance-033");
		arenaProp33.setOrigin(0.5, 1);
		arenaProp33.setDepth(1666);
		this.arenaProps.push(arenaProp33);

		// arenaProp34
		const arenaProp34 = this.add.image(639, 1606, "arena-prop-instance-034");
		arenaProp34.setOrigin(0.5, 1);
		arenaProp34.setDepth(1606);
		this.arenaProps.push(arenaProp34);

		// arenaProp35
		const arenaProp35 = this.add.image(1162.5, 1852, "arena-prop-instance-035");
		arenaProp35.setOrigin(0.5, 1);
		arenaProp35.setDepth(1852);
		this.arenaProps.push(arenaProp35);

		// arenaProp36
		const arenaProp36 = this.add.image(3819, 1699, "arena-prop-instance-036");
		arenaProp36.setOrigin(0.5, 1);
		arenaProp36.setDepth(1699);
		this.arenaProps.push(arenaProp36);

		// arenaProp37
		const arenaProp37 = this.add.image(369, 1729, "arena-prop-instance-037");
		arenaProp37.setOrigin(0.5, 1);
		arenaProp37.setDepth(1729);
		this.arenaProps.push(arenaProp37);

		// arenaProp38
		const arenaProp38 = this.add.image(2829, 1876, "arena-prop-instance-038");
		arenaProp38.setOrigin(0.5, 1);
		arenaProp38.setDepth(1876);
		this.arenaProps.push(arenaProp38);

		// arenaProp39
		const arenaProp39 = this.add.image(1809, 1729, "arena-prop-instance-039");
		arenaProp39.setOrigin(0.5, 1);
		arenaProp39.setDepth(1729);
		this.arenaProps.push(arenaProp39);

		// arenaProp40
		const arenaProp40 = this.add.image(2349, 1759, "arena-prop-instance-040");
		arenaProp40.setOrigin(0.5, 1);
		arenaProp40.setDepth(1759);
		this.arenaProps.push(arenaProp40);

		// arenaProp41
		const arenaProp41 = this.add.image(667.5, 1876, "arena-prop-instance-041");
		arenaProp41.setOrigin(0.5, 1);
		arenaProp41.setDepth(1876);
		this.arenaProps.push(arenaProp41);

		// arenaProp42
		const arenaProp42 = this.add.image(1642.5, 1921, "arena-prop-instance-042");
		arenaProp42.setOrigin(0.5, 1);
		arenaProp42.setDepth(1921);
		this.arenaProps.push(arenaProp42);

		// arenaProp43
		const arenaProp43 = this.add.image(2122.5, 1861, "arena-prop-instance-043");
		arenaProp43.setOrigin(0.5, 1);
		arenaProp43.setDepth(1861);
		this.arenaProps.push(arenaProp43);

		// arenaProp44
		const arenaProp44 = this.add.image(2467.5, 1936, "arena-prop-instance-044");
		arenaProp44.setOrigin(0.5, 1);
		arenaProp44.setDepth(1936);
		this.arenaProps.push(arenaProp44);

		// arenaProp45
		const arenaProp45 = this.add.image(3639, 2029, "arena-prop-instance-045");
		arenaProp45.setOrigin(0.5, 1);
		arenaProp45.setDepth(2029);
		this.arenaProps.push(arenaProp45);

		// arenaProp46
		const arenaProp46 = this.add.image(2109, 1969, "arena-prop-instance-046");
		arenaProp46.setOrigin(0.5, 1);
		arenaProp46.setDepth(1969);
		this.arenaProps.push(arenaProp46);

		// arenaProp47
		const arenaProp47 = this.add.image(3484.5, 2092, "arena-prop-instance-047");
		arenaProp47.setOrigin(0.5, 1);
		arenaProp47.setDepth(2092);
		this.arenaProps.push(arenaProp47);

		// arenaProp48
		const arenaProp48 = this.add.image(1777.5, 2221, "arena-prop-instance-048");
		arenaProp48.setOrigin(0.5, 1);
		arenaProp48.setDepth(2221);
		this.arenaProps.push(arenaProp48);

		// arenaProp49
		const arenaProp49 = this.add.image(2377.5, 2221, "arena-prop-instance-049");
		arenaProp49.setOrigin(0.5, 1);
		arenaProp49.setDepth(2221);
		this.arenaProps.push(arenaProp49);

		// arenaProp50
		const arenaProp50 = this.add.image(1209, 2134, "arena-prop-instance-050");
		arenaProp50.setOrigin(0.5, 1);
		arenaProp50.setDepth(2134);
		this.arenaProps.push(arenaProp50);

		// arenaProp51
		const arenaProp51 = this.add.image(3037.5, 2134, "arena-prop-instance-051");
		arenaProp51.setOrigin(0.5, 1);
		arenaProp51.setDepth(2134);
		this.arenaProps.push(arenaProp51);

		// arenaProp52
		const arenaProp52 = this.add.image(1567.5, 2176, "arena-prop-instance-052");
		arenaProp52.setOrigin(0.5, 1);
		arenaProp52.setDepth(2176);
		this.arenaProps.push(arenaProp52);

		// arenaProp53
		const arenaProp53 = this.add.image(2647.5, 2176, "arena-prop-instance-053");
		arenaProp53.setOrigin(0.5, 1);
		arenaProp53.setDepth(2176);
		this.arenaProps.push(arenaProp53);

		// arenaProp54
		const arenaProp54 = this.add.image(1119, 2179, "arena-prop-instance-054");
		arenaProp54.setOrigin(0.5, 1);
		arenaProp54.setDepth(2179);
		this.arenaProps.push(arenaProp54);

		// arenaProp55
		const arenaProp55 = this.add.image(2737.5, 2299, "arena-prop-instance-055");
		arenaProp55.setOrigin(0.5, 1);
		arenaProp55.setDepth(2299);
		this.arenaProps.push(arenaProp55);

		// arenaProp56
		const arenaProp56 = this.add.image(3579, 2344, "arena-prop-instance-056");
		arenaProp56.setOrigin(0.5, 1);
		arenaProp56.setDepth(2344);
		this.arenaProps.push(arenaProp56);

		// arenaProp57
		const arenaProp57 = this.add.image(1434, 2299, "arena-prop-instance-057");
		arenaProp57.setOrigin(0.5, 1);
		arenaProp57.setDepth(2299);
		this.arenaProps.push(arenaProp57);

		// arenaProp58
		const arenaProp58 = this.add.image(3277.5, 2476, "arena-prop-instance-058");
		arenaProp58.setOrigin(0.5, 1);
		arenaProp58.setDepth(2476);
		this.arenaProps.push(arenaProp58);

		// arenaProp59
		const arenaProp59 = this.add.image(517.5, 2449, "arena-prop-instance-059");
		arenaProp59.setOrigin(0.5, 1);
		arenaProp59.setDepth(2449);
		this.arenaProps.push(arenaProp59);

		// arenaProp60
		const arenaProp60 = this.add.image(2379, 2521, "arena-prop-instance-060");
		arenaProp60.setOrigin(0.5, 1);
		arenaProp60.setDepth(2521);
		this.arenaProps.push(arenaProp60);

		// arenaProp61
		const arenaProp61 = this.add.image(2107.5, 2437, "arena-prop-instance-061");
		arenaProp61.setOrigin(0.5, 1);
		arenaProp61.setDepth(2437);
		this.arenaProps.push(arenaProp61);

		// arenaProp62
		const arenaProp62 = this.add.image(985.5, 2701, "arena-prop-instance-062");
		arenaProp62.setOrigin(0.5, 1);
		arenaProp62.setDepth(2701);
		this.arenaProps.push(arenaProp62);

		// arenaProp63
		const arenaProp63 = this.add.image(2082, 2836, "arena-prop-instance-063");
		arenaProp63.setOrigin(0.5, 1);
		arenaProp63.setDepth(2836);
		this.arenaProps.push(arenaProp63);

		// arenaProp64
		const arenaProp64 = this.add.image(2287.5, 2719, "arena-prop-instance-064");
		arenaProp64.setOrigin(0.5, 1);
		arenaProp64.setDepth(2719);
		this.arenaProps.push(arenaProp64);

		// arenaProp65
		const arenaProp65 = this.add.image(2907, 2623, "arena-prop-instance-065");
		arenaProp65.setOrigin(0.5, 1);
		arenaProp65.setDepth(2623);
		this.arenaProps.push(arenaProp65);

		// arenaProp66
		const arenaProp66 = this.add.image(1927.5, 2716, "arena-prop-instance-066");
		arenaProp66.setOrigin(0.5, 1);
		arenaProp66.setDepth(2716);
		this.arenaProps.push(arenaProp66);

		// arenaProp67
		const arenaProp67 = this.add.image(3699, 2794, "arena-prop-instance-067");
		arenaProp67.setOrigin(0.5, 1);
		arenaProp67.setDepth(2794);
		this.arenaProps.push(arenaProp67);

		// arenaProp68
		const arenaProp68 = this.add.image(3369, 2779, "arena-prop-instance-068");
		arenaProp68.setOrigin(0.5, 1);
		arenaProp68.setDepth(2779);
		this.arenaProps.push(arenaProp68);

		// arenaProp69
		const arenaProp69 = this.add.image(787.5, 2779, "arena-prop-instance-069");
		arenaProp69.setOrigin(0.5, 1);
		arenaProp69.setDepth(2779);
		this.arenaProps.push(arenaProp69);

		// arenaProp70
		const arenaProp70 = this.add.image(1959, 2929, "arena-prop-instance-070");
		arenaProp70.setOrigin(0.5, 1);
		arenaProp70.setDepth(2929);
		this.arenaProps.push(arenaProp70);

		// arenaProp71
		const arenaProp71 = this.add.image(922.5, 3034, "arena-prop-instance-071");
		arenaProp71.setOrigin(0.5, 1);
		arenaProp71.setDepth(3034);
		this.arenaProps.push(arenaProp71);

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
