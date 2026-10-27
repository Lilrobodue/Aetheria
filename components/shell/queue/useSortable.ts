// components/shell/queue/useSortable.ts (v16.0, the Up next sheet's reorder; spec §3.12, mockup queue-phone-dragging)
//
// Reorder by the drag handle only, by pointer (mouse, pen, touch) or keyboard, with no library:
//   Pointer: a press of 150 ms or 6 px of movement lifts the row; it then follows the pointer (a transform written
//     straight to the element, so a move renders nothing), the rows between shift to make room, a dashed placeholder
//     marks where it will drop, and the list scrolls when the pointer is within 48 px of the scroller's edge. Only the
//     drop writes (onDrop: one editQueue, one App commit). Escape, a cancelled pointer or a lost capture put it back.
//   Keyboard (the WAI-ARIA sortable pattern, on the handle): Space or Enter lifts, ↑/↓ move, Space or Enter drops,
//     Escape puts it back; Alt+↑/↓ moves a row one place at once. Each step is announced (the caller's live region).
// The lifted row is held by its KEY, with how many places it has moved: the list can change under a lift (the track at
// the head starts playing and leaves it, another edit), so its place is found again at every render and at the drop,
// and the move stays the one the user made among its neighbours. A lifted row that leaves the list (it starts playing,
// is removed, the queue is cleared) ends the lift: nothing moves, and the caller is told ('gone').
// Escape while a row is lifted puts it back and never closes the sheet: the modal sheet's Escape (the overlay stack,
// first on window) reaches the sheet's onClose, which asks `cancelRef` first; the panel's (a document listener) is
// stopped by this hook's own capture listener on window. The rows must be the list's direct children, in order, all of
// one height while lifted (the caller closes any open row actions first).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The lifted row as this render sees it: its key, its place now, and the place it would drop at. */
export interface Lifted {
  key: string;
  from: number;
  target: number;
  mode: 'pointer' | 'keyboard';
}

interface Lift {
  key: string;
  /** Places moved from wherever the row is now (the target is its place plus this, within the list). */
  steps: number;
  mode: 'pointer' | 'keyboard';
}

interface Options {
  /** The rows' keys, in order (the list's children). */
  keys: readonly string[];
  /** The list (its children are the rows, in order). */
  listRef: { current: HTMLElement | null };
  /** The scroller the list sits in (auto-scroll). */
  scrollRef: { current: HTMLElement | null };
  /** A drop: the row's place and the place it goes to, in this render's list. Alt+arrow can ask past either end (the
   *  caller's queue may go on in another list); false: nothing moved (nothing is announced). */
  onDrop: (from: number, to: number) => boolean | void;
  /** Before a row lifts (the caller closes its row actions). */
  onLift?: () => void;
  /** 'moving' and 'dropped' with the place the row is at or goes to; 'cancelled' with its place; 'gone' when the
   *  lifted row left the list (place −1). */
  announce: (kind: 'moving' | 'dropped' | 'cancelled' | 'gone', key: string, at: number) => void;
  /** Set to a function that puts a lifted row back (true) or does nothing (false): the sheet's close asks it first. */
  cancelRef?: { current: (() => boolean) | null };
}

const LIFT_MS = 150;
const LIFT_PX = 6;
const EDGE_PX = 48;
const EDGE_SPEED = 8; // px per frame at the edge

interface Drag {
  key: string;
  pointerId: number;
  handle: HTMLElement;
  startY: number;
  lastY: number;
  startScroll: number;
  rowH: number;
  lifted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  raf: number;
  steps: number;
}

export function useSortable(o: Options) {
  const [lift, setLiftState] = useState<Lift | null>(null);
  // The lifted row's height, measured once the lift has rendered (any open row actions closed in the same batch).
  const [rowH, setRowH] = useState<number>(64);
  const liftRef: { current: Lift | null } = useRef(null);
  liftRef.current = lift;
  const dragRef: { current: Drag | null } = useRef(null);
  const optsRef: { current: Options } = useRef(o);
  optsRef.current = o;
  const setLift = (l: Lift | null) => {
    liftRef.current = l;
    setLiftState(l);
  };

  const placeOf = (key: string): number => optsRef.current.keys.indexOf(key);
  const rowEl = (i: number): HTMLElement | null => (i >= 0 ? ((optsRef.current.listRef.current?.children[i] as HTMLElement | undefined) ?? null) : null);
  const rowHeight = (i: number): number => rowEl(i)?.getBoundingClientRect().height ?? 64;
  const clampPlace = (i: number) => Math.max(0, Math.min(optsRef.current.keys.length - 1, i));

  /** Ends a lift (or a press not yet lifted): its transform, timer, frame and capture. The lifted key and its steps. */
  const release = (): { key: string; steps: number } | null => {
    const d = dragRef.current;
    dragRef.current = null;
    const l = liftRef.current;
    let out: { key: string; steps: number } | null = null;
    if (d) {
      if (d.timer) clearTimeout(d.timer);
      if (d.raf) cancelAnimationFrame(d.raf);
      try { d.handle.releasePointerCapture(d.pointerId); } catch {}
      const el = rowEl(placeOf(d.key));
      if (el) el.style.transform = '';
      if (d.lifted) out = { key: d.key, steps: d.steps };
    } else if (l) {
      out = { key: l.key, steps: l.steps };
    }
    if (liftRef.current) setLift(null);
    return out;
  };

  const end = (drop: boolean) => {
    const r = release();
    if (!r) return;
    const from = placeOf(r.key);
    if (from < 0) {
      optsRef.current.announce('gone', r.key, -1);
      return;
    }
    const target = clampPlace(from + r.steps);
    if (drop && target !== from) {
      if (optsRef.current.onDrop(from, target) !== false) optsRef.current.announce('dropped', r.key, target);
    } else {
      optsRef.current.announce(drop ? 'dropped' : 'cancelled', r.key, from);
    }
  };

  // The lifted row (or a press on its handle) left the list: the lift ends, nothing moves.
  const keysSig = o.keys.join('\n');
  useLayoutEffect(() => {
    const d = dragRef.current;
    const key = d ? d.key : liftRef.current?.key;
    if (key !== undefined && placeOf(key) < 0) {
      const wasLifted = !!liftRef.current || !!d?.lifted;
      release();
      if (wasLifted) optsRef.current.announce('gone', key, -1);
    }
  }, [keysSig]);

  const liftedKey = lift ? lift.key : null;
  useLayoutEffect(() => {
    if (liftedKey === null) return;
    const h = rowHeight(placeOf(liftedKey));
    if (h > 0 && h !== rowH) setRowH(h);
    if (dragRef.current) dragRef.current.rowH = h;
  }, [liftedKey]);

  // The list unmounts under a lift or a press (its run left the sheet, the sheet closed): the press timer, the
  // edge-scroll frames and the pointer capture go with it, or the frames would go on scrolling the sheet.
  useEffect(() => () => {
    const d = dragRef.current;
    dragRef.current = null;
    liftRef.current = null;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    if (d.raf) cancelAnimationFrame(d.raf);
    d.raf = 0;
    try { d.handle.releasePointerCapture(d.pointerId); } catch {}
  }, []);

  // The sheet's close (Escape on the modal sheet, its Close, its scrim) puts a lifted row back instead of closing.
  useLayoutEffect(() => {
    if (!o.cancelRef) return;
    o.cancelRef.current = () => {
      if (!liftRef.current && !dragRef.current?.lifted) return false;
      end(false);
      return true;
    };
    return () => {
      if (o.cancelRef) o.cancelRef.current = null;
    };
  });

  // Escape while lifted, in the panel: before its own Escape (a document listener).
  useEffect(() => {
    if (!lift) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lift !== null]);

  // A pointer drag: the lifted row follows the pointer (scroll included); the target is where its middle is. The row
  // moves with the list when the list changes above it, so the places moved count from wherever it is now.
  const follow = () => {
    const d = dragRef.current;
    if (!d || !d.lifted) return;
    const sc = optsRef.current.scrollRef.current;
    const dy = d.lastY - d.startY + ((sc?.scrollTop ?? 0) - d.startScroll);
    const from = placeOf(d.key);
    if (from < 0) return;
    const el = rowEl(from);
    if (el) el.style.transform = `translateY(${dy}px)`;
    const steps = clampPlace(from + Math.round(dy / d.rowH)) - from;
    if (steps !== d.steps) {
      d.steps = steps;
      setLift({ key: d.key, steps, mode: 'pointer' });
    }
  };
  const edgeScroll = () => {
    const d = dragRef.current;
    if (!d || !d.lifted) return;
    d.raf = 0;
    if (!optsRef.current.listRef.current?.isConnected) return; // the list is gone: no more frames
    const sc = optsRef.current.scrollRef.current;
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    const v = d.lastY < r.top + EDGE_PX ? -EDGE_SPEED : d.lastY > r.bottom - EDGE_PX ? EDGE_SPEED : 0;
    if (!v) return;
    const before = sc.scrollTop;
    sc.scrollTop = before + v;
    if (sc.scrollTop !== before) follow();
    d.raf = requestAnimationFrame(edgeScroll);
  };
  const liftDrag = (d: Drag) => {
    if (d.lifted || placeOf(d.key) < 0) return;
    optsRef.current.onLift?.();
    d.lifted = true;
    if (d.timer) clearTimeout(d.timer);
    d.timer = null;
    setLift({ key: d.key, steps: 0, mode: 'pointer' });
    optsRef.current.announce('moving', d.key, placeOf(d.key));
    follow();
  };

  const makeHandle = (key: string) => ({
    onPointerDown: (e: PointerEvent & { currentTarget: HTMLElement }) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (liftRef.current || dragRef.current) return;
      const handle = e.currentTarget;
      const sc = optsRef.current.scrollRef.current;
      const d: Drag = { key, pointerId: e.pointerId, handle, startY: e.clientY, lastY: e.clientY, startScroll: sc?.scrollTop ?? 0, rowH: 64, lifted: false, timer: null, raf: 0, steps: 0 };
      dragRef.current = d;
      try { handle.setPointerCapture(e.pointerId); } catch {}
      d.timer = setTimeout(() => { if (dragRef.current === d) liftDrag(d); }, LIFT_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.lastY = e.clientY;
      if (!d.lifted) {
        if (Math.abs(e.clientY - d.startY) >= LIFT_PX) liftDrag(d);
        return;
      }
      follow();
      if (!d.raf) d.raf = requestAnimationFrame(edgeScroll);
    },
    onPointerUp: (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.lifted) end(true);
      else {
        // A press without a drag: nothing moves.
        if (d.timer) clearTimeout(d.timer);
        dragRef.current = null;
        try { d.handle.releasePointerCapture(d.pointerId); } catch {}
      }
    },
    onPointerCancel: (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.lifted) end(false);
      else {
        if (d.timer) clearTimeout(d.timer);
        dragRef.current = null;
      }
    },
    onLostPointerCapture: (e: PointerEvent) => {
      const d = dragRef.current;
      if (d && e.pointerId === d.pointerId && d.lifted) end(false);
    },
    onKeyDown: (e: KeyboardEvent) => {
      const l = liftRef.current;
      const k = e.key;
      const at = placeOf(key);
      if (at < 0) return;
      if (!l) {
        if (k === ' ' || k === 'Enter') {
          optsRef.current.onLift?.();
          setLift({ key, steps: 0, mode: 'keyboard' });
          optsRef.current.announce('moving', key, at);
        } else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
          // One place at once; past this list's ends the caller decides (its queue may go on in another list).
          const to = at + (k === 'ArrowUp' ? -1 : 1);
          if (optsRef.current.onDrop(at, to) !== false) optsRef.current.announce('dropped', key, to);
        } else return;
        e.preventDefault();
        return;
      }
      if (l.mode !== 'keyboard' || l.key !== key) return;
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        const target = clampPlace(at + l.steps + (k === 'ArrowUp' ? -1 : 1));
        if (target - at !== l.steps) {
          setLift({ ...l, steps: target - at });
          optsRef.current.announce('moving', key, target);
        }
      } else if (k === ' ' || k === 'Enter') {
        end(true);
      } else return;
      e.preventDefault();
    },
    onBlur: () => {
      const l = liftRef.current;
      if (l && l.mode === 'keyboard' && l.key === key) end(false);
    },
  });
  // One set of handlers per row key, for the row's lifetime (the rows are React.memo).
  const handlesRef: { current: Map<string, ReturnType<typeof makeHandle>> } = useRef(new Map());
  const handleProps = (key: string) => {
    let h = handlesRef.current.get(key);
    if (!h) {
      h = makeHandle(key);
      handlesRef.current.set(key, h);
    }
    return h;
  };
  useEffect(() => {
    const keep = new Set(o.keys);
    for (const k of handlesRef.current.keys()) if (!keep.has(k)) handlesRef.current.delete(k);
  }, [keysSig]);

  // The lift as this render sees it: the row's place now, and its target.
  const from = lift ? o.keys.indexOf(lift.key) : -1;
  const lifted: Lifted | null = lift && from >= 0 ? { key: lift.key, from, target: Math.max(0, Math.min(o.keys.length - 1, from + lift.steps)), mode: lift.mode } : null;

  /** A row's offset while one is lifted: the lifted one (keyboard: to its target slot; pointer: written directly), the
   *  rows between its place and its target shift by its height. */
  const offsetOf = (i: number): number => {
    const l = lifted;
    if (!l) return 0;
    if (i === l.from) return l.mode === 'keyboard' ? (l.target - l.from) * rowH : NaN;
    if (l.from < l.target && i > l.from && i <= l.target) return -rowH;
    if (l.from > l.target && i >= l.target && i < l.from) return rowH;
    return 0;
  };

  /** Where the dropped row will sit (the placeholder): the target row's place in the list's layout. */
  const slotTop = (i: number): number => rowEl(i)?.offsetTop ?? 0;

  return { lifted, handleProps, offsetOf, rowH, slotTop };
}
