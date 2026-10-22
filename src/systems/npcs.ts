import type Phaser from 'phaser';
import dialogue from '../data/dialogue.json';
import { DIRECTIONS, NPC_FRAME, type Direction } from '../config';

/** Dialogue ID -> string IDs, one per page or more (src/data/dialogue.json). */
export const DIALOGUE: Readonly<Record<string, readonly string[]>> = dialogue;

export interface NpcSpawn {
  npcId: string;
  dialogueId: string;
  facing: Direction;
  look: number;
  /** Feet position. */
  x: number;
  y: number;
}

export const NPC_LAYER = 'npcs';

/**
 * Reads NPCs from the Tiled object layer "npcs": one point per NPC, at its feet, with
 * string properties npcId, facing (down/left/right/up) and dialogueId, and an optional
 * int property look (row of the NPC sheet, default 0). Throws on anything malformed so
 * a map mistake fails loudly at load rather than as a silent missing NPC.
 */
export function readNpcSpawns(map: Phaser.Tilemaps.Tilemap): NpcSpawn[] {
  const layer = map.getObjectLayer(NPC_LAYER);
  if (!layer) return [];
  const seen = new Set<string>();
  return layer.objects.map((obj) => {
    const where = `NPC object ${obj.id} in layer "${NPC_LAYER}"`;
    const props = new Map<string, unknown>(
      ((obj.properties ?? []) as { name: string; value: unknown }[]).map((p) => [p.name, p.value]),
    );
    const str = (name: string): string => {
      const v = props.get(name);
      if (typeof v !== 'string' || v === '') throw new Error(`${where}: needs string property "${name}"`);
      return v;
    };
    const npcId = str('npcId');
    const dialogueId = str('dialogueId');
    const facing = str('facing') as Direction;
    const look = props.get('look') ?? 0;
    if (!obj.point || obj.x === undefined || obj.y === undefined) throw new Error(`${where}: must be a point`);
    if (!DIRECTIONS.includes(facing)) throw new Error(`${where}: facing must be one of ${DIRECTIONS.join('/')}`);
    if (!(dialogueId in DIALOGUE)) throw new Error(`${where}: unknown dialogueId "${dialogueId}"`);
    if (!Number.isInteger(look) || (look as number) < 0 || (look as number) >= NPC_FRAME.looks) {
      throw new Error(`${where}: look must be an int from 0 to ${NPC_FRAME.looks - 1}`);
    }
    if (seen.has(npcId)) throw new Error(`${where}: duplicate npcId "${npcId}"`);
    seen.add(npcId);
    return { npcId, dialogueId, facing, look: look as number, x: obj.x, y: obj.y };
  });
}
