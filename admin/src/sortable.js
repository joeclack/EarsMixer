import { useEffect, useRef } from "preact/hooks";

// Drag to reorder with SortableJS. The library moves the DOM node itself, so put
// it back and let the state change draw the new order.
export function useSortable(ref, handle, onMove, enabled = true) {
  const callback = useRef(onMove);
  callback.current = onMove;
  useEffect(() => {
    if (!enabled || !ref.current || !window.Sortable) return undefined;
    const sortable = new window.Sortable(ref.current, {
      handle, draggable: "> li", animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150,
      ghostClass: "drag-ghost", forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4,
      onEnd(event) {
        const { from, item, oldIndex, newIndex } = event;
        if (oldIndex === newIndex) return;
        item.remove(); from.insertBefore(item, from.children[oldIndex] || null);
        callback.current(oldIndex, newIndex);
      },
    });
    return () => sortable.destroy();
  }, [enabled, handle]);
}
// Up and down arrow keys on a drag handle move its row.
export function arrowMove(event, index, length, onMove) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const to = index + (event.key === "ArrowUp" ? -1 : 1);
  if (to >= 0 && to < length) onMove(index, to);
}
