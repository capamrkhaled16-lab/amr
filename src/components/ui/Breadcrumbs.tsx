import { Home, ChevronLeft } from 'lucide-react';

export type Crumb = {
  label: string;
  isLast?: boolean;
};

type BreadcrumbsProps = {
  crumbs: Crumb[];
  onHomeClick?: () => void;
};

export default function Breadcrumbs({ crumbs, onHomeClick }: BreadcrumbsProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400 glass-light px-3 sm:px-4 py-2 rounded-xl w-fit max-w-full overflow-x-auto">
      <button
        onClick={onHomeClick}
        className="flex items-center gap-1 text-slate-400 hover:text-emerald-400 transition flex-shrink-0"
      >
        <Home size={13} />
        <span className="hidden sm:inline">الرئيسية</span>
      </button>
      {crumbs.map((crumb, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
          <ChevronLeft size={12} className="text-slate-600" />
          <span
            className={
              crumb.isLast
                ? 'text-emerald-400 font-bold'
                : 'text-slate-400'
            }
          >
            {crumb.label}
          </span>
        </div>
      ))}
    </div>
  );
}
