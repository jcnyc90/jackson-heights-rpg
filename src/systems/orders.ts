import data from '../data/orders.json';
import { getMap } from './maps';
import { hasString, t } from './strings';

// Delivery orders (src/data/orders.json). See DESIGN.md 2.13.

export interface OrderStop {
  map: string;
  pointId: string;
}

export interface Order {
  id: string;
  itemId: string;
  reward: number;
  pickup: OrderStop;
  dropoff: OrderStop;
  /** String IDs (t()) of everything the player reads about this order. */
  text: { item: string; assign: string; pickedUp: string; delivered: string };
}

const TEXT_KEYS = ['item', 'assign', 'pickedUp', 'delivered'] as const;

/**
 * Validates raw order data: field types, unique ids, a non-negative reward, pickup and
 * dropoff naming a registered map and a delivery point on it (and not the same point), and
 * every string ID existing. When `strict` (dev builds) the first problem throws; in
 * production a bad order is dropped with a warning, so the rest still play.
 */
export function parseOrders(raw: unknown, strict: boolean = import.meta.env.DEV): Order[] {
  const list = (raw as { orders?: unknown } | null)?.orders;
  if (!Array.isArray(list)) throw new Error('orders.json: needs an "orders" array');
  const orders: Order[] = [];
  const ids = new Set<string>();
  list.forEach((entry: unknown, i) => {
    try {
      orders.push(parseOrder(entry, i, ids));
    } catch (e) {
      if (strict) throw e;
      console.warn(`[orders] skipping: ${(e as Error).message}`);
    }
  });
  return orders;
}

function parseOrder(entry: unknown, index: number, ids: Set<string>): Order {
  const o = (entry ?? {}) as Record<string, unknown>;
  let where = `orders.json, order ${index}`;
  const str = (v: unknown, name: string): string => {
    if (typeof v !== 'string' || v === '') throw new Error(`${where}: needs string "${name}"`);
    return v;
  };
  const id = str(o.id, 'id');
  where += ` ("${id}")`;
  if (ids.has(id)) throw new Error(`${where}: duplicate id`);
  const itemId = str(o.itemId, 'itemId');
  if (typeof o.reward !== 'number' || !Number.isFinite(o.reward) || o.reward < 0) throw new Error(`${where}: reward must be a number >= 0`);
  const stop = (name: 'pickup' | 'dropoff'): OrderStop => {
    const s = (o[name] ?? {}) as Record<string, unknown>;
    const map = str(s.map, `${name}.map`);
    const pointId = str(s.pointId, `${name}.pointId`);
    const info = getMap(map);
    if (!info) throw new Error(`${where}: ${name} names unknown map "${map}"`);
    if (!info.deliveryPoints.some((p) => p.pointId === pointId)) throw new Error(`${where}: map "${map}" has no delivery point "${pointId}"`);
    return { map, pointId };
  };
  const pickup = stop('pickup');
  const dropoff = stop('dropoff');
  if (pickup.map === dropoff.map && pickup.pointId === dropoff.pointId) throw new Error(`${where}: pickup and dropoff are the same point`);
  const rawText = (o.text ?? {}) as Record<string, unknown>;
  const text = {} as Order['text'];
  for (const key of TEXT_KEYS) {
    const sid = str(rawText[key], `text.${key}`);
    if (!hasString(sid)) throw new Error(`${where}: text.${key} names missing string "${sid}"`);
    text[key] = sid;
  }
  ids.add(id);
  return { id, itemId, reward: o.reward, pickup, dropoff, text };
}

/** Every order, in the order the dispatcher hands them out. */
export const ORDERS: readonly Order[] = parseOrders(data);

/** Placeholder values for an order's strings: {item}, {pickup}, {dropoff} (map display names), {reward}. */
export function orderParams(order: Order): Record<string, string | number> {
  const mapName = (id: string) => t(getMap(id)?.nameId ?? id);
  return { item: t(order.text.item), pickup: mapName(order.pickup.map), dropoff: mapName(order.dropoff.map), reward: order.reward };
}
