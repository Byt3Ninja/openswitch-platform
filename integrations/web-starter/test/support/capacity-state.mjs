/** Valid on-disk fixture at a chosen byte boundary, without a test-only runtime limit. */
export function capacityState(namespace, order, size) {
  const state = { version: 1, namespace, orders: { [order.id]: order } };
  let bytes = Buffer.byteLength(JSON.stringify(state));
  const fillers = [];
  while (bytes < size) {
    const id = `filler_${fillers.length}_`.padEnd(128, 'x');
    const filler = { ...order, id, paymentId: id, catalogId: 'x'.repeat(128), phase: 'new' };
    delete filler.paymentStatus;
    state.orders[id] = filler;
    fillers.push(filler);
    bytes += Buffer.byteLength(JSON.stringify(id)) + 1 + Buffer.byteLength(JSON.stringify(filler)) + 1;
  }
  let excess = bytes - size;
  for (const filler of fillers.toReversed()) {
    const reduction = Math.min(excess, 127);
    filler.catalogId = filler.catalogId.slice(reduction);
    excess -= reduction;
    if (!excess) break;
  }
  if (excess) throw new Error('Capacity fixture cannot fit requested boundary');
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized) !== size) throw new Error('Capacity fixture size mismatch');
  return serialized;
}
