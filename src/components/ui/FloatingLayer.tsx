import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type FloatingLayerProps = {
  children: ReactNode;
  zIndex?: number;
};

export default function FloatingLayer({ children, zIndex = 99999 }: FloatingLayerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div style={{ position: 'fixed', top: 0, left: 0, zIndex, pointerEvents: 'none' }}>
      {children}
    </div>,
    document.body,
  );
}
