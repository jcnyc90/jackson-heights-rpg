import { ORDERS, type Order } from './orders';

// Game state that outlives a map: MapScene restarts on every warp, so anything that must
// survive one lives here, in memory. Nothing is saved yet (saves come later).

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
export class GameState {
  active: ActiveOrder | null = null;
  completed: string[] = [];
  rewardTotal = 0;

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

  reset(): void {
    this.active = null;
    this.completed = [];
    this.rewardTotal = 0;
  }
}

export const gameState = new GameState(ORDERS);
