/** Fill the connection with growing circles, leaving clearance at both ends. */
export function thoughtTail(head: {x: number; y: number}, edge: {x: number; y: number}, scale = 1) {
  const dx = edge.x - head.x, dy = edge.y - head.y;
  const distance = Math.hypot(dx, dy);
  const clearance = 12 * scale;
  const length = distance - clearance - 4;
  if (length < 8 * scale) return [];
  const count = Math.max(1, Math.min(12, Math.floor(length / (24 * scale + 10))));
  const diameters = Array.from({length: count}, (_, i) => count === 1 ? Math.min(16 * scale, length) : (8 + 24 * i / (count - 1)) * scale);
  const gap = (length - diameters.reduce((sum, size) => sum + size, 0)) / (count + 1);
  let offset = clearance + gap;
  return diameters.map(diameter => {
    const fraction = (offset + diameter / 2) / distance;
    offset += diameter + gap;
    return {left: head.x + dx * fraction - diameter / 2, top: head.y + dy * fraction - diameter / 2, width: diameter, height: diameter};
  });
}
