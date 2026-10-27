import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Save validation (Node)', async () => {
    global.localStorage = {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, value) { this.store[key] = value; },
      clear() { this.store = {}; }
    };

    const fs = await import('fs');
    const orders = JSON.parse(fs.readFileSync(new URL('../../src/data/orders.json', import.meta.url), 'utf8')).orders;

    assert.ok(orders.length >= 6, 'Should have at least 6 orders expanded');
    assert.ok(orders.some(o => o.id === 'order-4'), 'Should have order-4');
    assert.ok(orders.some(o => o.id === 'order-5'), 'Should have order-5');

    const en = JSON.parse(fs.readFileSync(new URL('../../src/data/strings/en.json', import.meta.url), 'utf8'));
    assert.ok(en['item.order-4.name'], 'Should have strings for order-4');
    assert.ok(en['order.order-4.assign'], 'Should have strings for order-4 dialog');
});
