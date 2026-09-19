import { useCallback, useEffect, useRef } from 'react';

interface Props {
  axis: 'col' | 'row';
  min?: number;
  max?: number;
  initial?: number;
  containerRef: React.RefObject<HTMLElement | null>;
  onResize: (percent: number) => void;
}

export default function ResizablePanel({
  axis,
  min = 20,
  max = 80,
  containerRef,
  onResize,
}: Props) {
  const activeRef = useRef(false);

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!activeRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct =
        axis === 'col'
          ? ((clientX - rect.left) / rect.width) * 100
          : ((clientY - rect.top) / rect.height) * 100;
      onResize(Math.max(min, Math.min(max, pct)));
    },
    [axis, min, max, containerRef, onResize],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (activeRef.current) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      }
    };
    const onEnd = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchend', onEnd);
    };
  }, [handleMove]);

  const onStart = (e: React.MouseEvent | React.TouchEvent) => {
    activeRef.current = true;
    document.body.style.cursor = axis === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  return <div className={`gutter gutter-${axis}`} onMouseDown={onStart} onTouchStart={onStart} />;
}
