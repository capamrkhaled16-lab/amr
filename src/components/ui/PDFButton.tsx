import { useState, useRef, useCallback } from 'react';
import { FileText, Loader2, ChevronDown } from 'lucide-react';

type PDFButtonProps = {
  label?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  onClick: () => Promise<boolean>;
  className?: string;
  disabled?: boolean;
};

export function PDFButton({
  label = 'تصدير PDF',
  size = 'sm',
  variant = 'secondary',
  onClick,
  className = '',
  disabled = false,
}: PDFButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(async () => {
    if (state === 'loading' || disabled) return;
    setState('loading');
    try {
      const ok = await onClick();
      setState(ok ? 'success' : 'error');
    } catch {
      setState('error');
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState('idle'), 2000);
  }, [onClick, state, disabled]);

  const sizeCls = size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2';
  const baseCls = 'inline-flex items-center gap-1.5 rounded-xl font-bold transition active:scale-95 border';
  const variantCls = variant === 'primary'
    ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25'
    : 'glass-light border-white/10 text-slate-300 hover:bg-white/10 hover:text-amber-400';

  const stateIcon = state === 'loading'
    ? <Loader2 size={14} className="animate-spin" />
    : <FileText size={14} />;

  const stateLabel = state === 'loading' ? 'جاري التصدير...'
    : state === 'success' ? 'تم التصدير'
    : state === 'error' ? 'فشل التصدير'
    : label;

  const stateCls = state === 'success'
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : state === 'error'
    ? 'text-red-400 border-red-500/30 bg-red-500/10'
    : variantCls;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading' || disabled}
      className={`${baseCls} ${sizeCls} ${stateCls} ${className}`}
    >
      {stateIcon}
      {stateLabel}
    </button>
  );
}

type PDFDropdownItem = {
  label: string;
  icon?: typeof FileText;
  onClick: () => Promise<boolean>;
  disabled?: boolean;
};

type PDFDropdownProps = {
  label?: string;
  size?: 'sm' | 'md';
  items: PDFDropdownItem[];
  disabled?: boolean;
};

export function PDFDropdown({ label = 'تصدير PDF', size = 'sm', items, disabled = false }: PDFDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="relative inline-block" ref={ref}>
      <PDFButton
        label={label}
        size={size}
        onClick={async () => { setOpen((v) => !v); return true; }}
        disabled={disabled}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-2 z-50 min-w-48 glass-dark rounded-xl border border-white/10 shadow-2xl overflow-hidden">
            {items.map((item, i) => (
              <PDFButton
                key={i}
                label={item.label}
                size="md"
                variant="secondary"
                onClick={async () => { setOpen(false); return item.onClick(); }}
                disabled={item.disabled}
                className="w-full justify-start border-0 rounded-none hover:bg-white/5"
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
