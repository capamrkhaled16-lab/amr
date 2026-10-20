import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import StudentViewModal from '@/components/ui/StudentViewModal';
import { formatCurrency } from '@/lib/format';
import { exportStudentListPDF, exportUnpaidStudentsPDF, exportPaidStudentsPDF } from '@/lib/pdfExport';
import { classifyStudentPayment } from '@/lib/financeCalc';
import { PDFButton } from '@/components/ui/PDFButton';
import { Eye } from 'lucide-react';
import type { Student } from '@/lib/types';

type DrillCategory = 'fullyPaid' | 'partial' | 'unpaid' | 'collected' | 'all';

type EnrichedStudent = Student & { group_name?: string; grade_name?: string; stage_name?: string };

type Props = {
  open: boolean;
  category: DrillCategory | null;
  students: EnrichedStudent[];
  monthlyPaidMap: Map<string, number>;
  monthExemptMap: Map<string, true>;
  onClose: () => void;
};

const CATEGORY_META: Record<DrillCategory, { title: string; color: string; icon: string }> = {
  fullyPaid: { title: 'الطلاب الذين سددوا بالكامل', color: 'text-emerald-400', icon: '✓' },
  partial: { title: 'الطلاب الذين سددوا جزئياً', color: 'text-amber-400', icon: '◐' },
  unpaid: { title: 'الطلاب الذين لم يسددوا (متبقي)', color: 'text-red-400', icon: '✗' },
  collected: { title: 'المبلغ المحصل — الطلاب الذين دفعوا', color: 'text-emerald-400', icon: '₪' },
  all: { title: 'جميع الطلاب', color: 'text-white', icon: '◉' },
};

export default function DrillDownModal({ open, category, students, monthlyPaidMap, monthExemptMap, onClose }: Props) {
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const filtered = useMemo(() => {
    if (!category) return [];
    return students.filter((s) => {
      if (category === 'all') return true;
      const { category: cat, paid } = classifyStudentPayment(s, monthlyPaidMap, monthExemptMap);
      if (category === 'fullyPaid') return cat === 'fullyPaid';
      if (category === 'partial') return cat === 'partial';
      if (category === 'unpaid') return cat === 'unpaid';
      if (category === 'collected') return paid > 0;
      return false;
    });
  }, [category, students, monthlyPaidMap, monthExemptMap]);

  if (!category) return null;
  const meta = CATEGORY_META[category];

  function handlePremiumPDF() {
    if (category === 'unpaid') {
      return exportUnpaidStudentsPDF(students, monthlyPaidMap, monthExemptMap, { title: meta.title });
    }
    if (category === 'fullyPaid') {
      return exportPaidStudentsPDF(students, monthlyPaidMap, monthExemptMap, { title: meta.title });
    }
    return exportStudentListPDF(filtered, { title: meta.title });
  }

  return (
    <>
    <Modal open={open} onClose={onClose} title={meta.title} size="lg">
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="glass-light rounded-xl px-4 py-2">
            <span className="text-xs text-slate-400">إجمالي الطلاب: </span>
            <span className={'text-lg font-bold ' + meta.color}>{filtered.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <PDFButton
              label="تصدير PDF"
              size="sm"
              variant="secondary"
              disabled={filtered.length === 0}
              onClick={async () => handlePremiumPDF()}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-8">لا يوجد طلاب في هذه الفئة.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-2 modal-body">
            {filtered.map((s, i) => {
              const monthlyPaid = monthlyPaidMap.get(s.id) ?? 0;
              const remaining = Math.max(0, (s.total_fees ?? 0) - monthlyPaid);
              return (
                <div key={s.id} className="glass-light rounded-xl p-3 flex items-center gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-lg glass-light flex items-center justify-center text-xs font-bold text-slate-400">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm break-words leading-snug">{s.name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {s.stage_name ?? '-'} {s.grade_name ? '• ' + s.grade_name : ''} {s.group_name ? '• ' + s.group_name : ''}
                    </p>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <p className="text-xs text-emerald-400 font-bold">{formatCurrency(monthlyPaid)} ج.م</p>
                    {remaining > 0 && <p className="text-[11px] text-amber-400">متبقي: {formatCurrency(remaining)}</p>}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewTarget(s); }}
                    className="p-2 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 hover:text-sky-400 transition flex-shrink-0 active:scale-90"
                    title="عرض"
                  >
                    <Eye size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>

    <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </>
  );
}

