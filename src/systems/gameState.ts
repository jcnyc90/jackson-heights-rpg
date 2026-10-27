import { BIKE_SHARE } from '../config';
import { ORDERS, type Order } from './orders';

// Game state that outlives a map: MapScene restarts on every warp, so anything that must
// survive one lives here, in memory. Nothing is saved yet (saves come later): orders, the bike-share
// dock counts, whether the player is riding, and the speed setting (session 6f) last for the page load.

export type OrderStatus = 'assigned' | 'picked-up';

export interface ActiveOrder {
  order: Order;
  status: OrderStatus;
}

export type AssignResult =
  | { kind: 'assigned'; order: Order }
  | { kind: 'busy'; active: ActiveOrder }
  | { kind: 'none-left' };

export type PointResult =
  | { kind: 'picked-up' | 'delivered' | 'not-picked-up'; order: Order }
  | { kind: 'nothing' };

/**
 * One active order at a time: assigned -> picked up -> delivered. The dispatcher hands out
 * orders in list order, skipping completed ones; delivering adds the order's reward to the total.
 */
import type { Direction } from '../config';
import { getMap, START } from './maps';

export interface SaveData {
  v: 1;
  mapId: string;
  tileX: number;
  tileY: number;
  facing: Direction;
  riding: boolean;
  speedLevel: number;
  docked: [string, number][];
  active: ActiveOrder | null;
  completed: string[];
  rewardTotal: number;
}

export class GameState {
  saveKey = 'jh_save';
  savedMapId = START.map.id;
  savedTileX = START.spawn.x / 16;
  savedTileY = START.spawn.y / 16;
  savedFacing: Direction = START.spawn.facing;

  active: ActiveOrder | null = null;
  completed: string[] = [];
  rewardTotal = 0;
  /** Bikes docked per dock id (session 6f); a dock not in the map yet holds BIKE_SHARE.bikesAtStart. */
  private readonly docked = new Map<string, number>();
  /** True while the player rides a rented bike. */
  riding = false;
  /** Speed setting 0-3 (the speed buttons): the multiplier is 2 ** speedLevel. */
  speedLevel = 0;

  save(mapId: string = this.savedMapId, tileX: number = this.savedTileX, tileY: number = this.savedTileY, facing: Direction = this.savedFacing): void {
    if (mapId !== 'jackson-heights') return;

    this.savedMapId = mapId;
    this.savedTileX = tileX;
    this.savedTileY = tileY;
    this.savedFacing = facing;

    const data: SaveData = {
      v: 1,
      mapId,
      tileX,
      tileY,
      facing,
      riding: this.riding,
      speedLevel: this.speedLevel,
      docked: Array.from(this.docked.entries()),
      active: this.active,
      completed: this.completed,
      rewardTotal: this.rewardTotal,
    };
    try {
      localStorage.setItem(this.saveKey, JSON.stringify(data));
    } catch (e) {
      console.warn('[gameState] failed to save to localStorage', e);
    }
  }

  load(): boolean {
    let json: string | null = null;
    try {
      json = localStorage.getItem(this.saveKey);
    } catch (e) {
      return false;
    }
    if (!json) return false;

    let data: SaveData;
    try {
      data = JSON.parse(json);
    } catch (e) {
      return false;
    }

    if (data.v !== 1 || typeof data.mapId !== 'string' || data.mapId !== 'jackson-heights' ||
        typeof data.tileX !== 'number' || typeof data.tileY !== 'number' ||
        typeof data.riding !== 'boolean' || typeof data.speedLevel !== 'number' ||
        !Array.isArray(data.docked) || !Array.isArray(data.completed) ||
        typeof data.rewardTotal !== 'number') {
      return false;
    }

    const mapInfo = getMap(data.mapId);
    if (!mapInfo || !mapInfo.world) return false;

    const { world } = mapInfo;
    const { tileX, tileY } = data;
    const tx = Math.floor(tileX);
    const ty = Math.floor(tileY);

    let valid = tx >= 0 && tx < world.width && ty >= 0 && ty < world.height;
    if (valid) {
      const idx = ty * world.width + tx;
      valid = world.solid[idx] === 0;
    }

    if (!valid) {
      this.savedMapId = START.map.id;
      this.savedTileX = START.spawn.x / 16;
      this.savedTileY = START.spawn.y / 16;
      this.savedFacing = START.spawn.facing;
      this.riding = false;
    } else {
      this.savedMapId = data.mapId;
      this.savedTileX = data.tileX;
      this.savedTileY = data.tileY;
      this.savedFacing = data.facing;
      this.riding = data.riding;

      if (this.riding) {
        const idx = ty * world.width + tx;
        const gid = world.ground[idx];
        // @ts-ignore
        const isRideable = [
          'road', 'sidewalk', 'curb-', 'center-line-', 'lane-dash-',
          'crosswalk-', 'el-shadow', 'plaza', 'paseo-grass', 'bike-lane'
        ].some(prefix => (mapInfo as any)?.tileNames?.[gid]?.startsWith(prefix) ?? true);
      }
    }

    this.speedLevel = data.speedLevel;
    this.active = data.active;
    this.completed = data.completed;
    this.rewardTotal = data.rewardTotal;

    this.docked.clear();
    for (const [id, count] of data.docked) {
      this.docked.set(id, count);
    }

    return true;
  }

  constructor(readonly orders: readonly Order[]) {}

  /** The dispatcher's job: assign the next order unless one is already active. */
  assignNext(): AssignResult {
    if (this.active) return { kind: 'busy', active: this.active };
    const order = this.orders.find((o) => !this.completed.includes(o.id));
    if (!order) return { kind: 'none-left' };
    this.active = { order, status: 'assigned' };
    return { kind: 'assigned', order };
  }

  /** Action at a delivery point: picks up or delivers the active order if this is its point. */
  interact(mapId: string, pointId: string): PointResult {
    const active = this.active;
    if (!active) return { kind: 'nothing' };
    const { order } = active;
    const at = (stop: Order['pickup']) => stop.map === mapId && stop.pointId === pointId;
    if (active.status === 'assigned' && at(order.pickup)) {
      active.status = 'picked-up';
      return { kind: 'picked-up', order };
    }
    if (at(order.dropoff)) {
      if (active.status === 'assigned') return { kind: 'not-picked-up', order };
      this.active = null;
      this.completed.push(order.id);
      this.rewardTotal += order.reward;
      return { kind: 'delivered', order };
    }
    return { kind: 'nothing' };
  }

  /** Bikes docked at a dock right now. */
  bikesAt(dockId: string): number {
    return this.docked.get(dockId) ?? BIKE_SHARE.bikesAtStart;
  }

  /** Rents a bike from the dock if it has one and the player isn't riding: true if rented. */
  rent(dockId: string): boolean {
    const n = this.bikesAt(dockId);
    if (this.riding || n <= 0) return false;
    this.docked.set(dockId, n - 1);
    this.riding = true;
    return true;
  }

  /** Returns the ridden bike to the dock if it has a free slot: true if returned. */
  giveBack(dockId: string, slots: number): boolean {
    const n = this.bikesAt(dockId);
    if (!this.riding || n >= slots) return false;
    this.docked.set(dockId, n + 1);
    this.riding = false;
    return true;
  }

  reset(): void {
    this.active = null;
    this.completed = [];
    this.rewardTotal = 0;
    this.docked.clear();
    this.riding = false;
    this.speedLevel = 0;
  }
}

export const gameState = new GameState(ORDERS);
