import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, GraduationCap, BookOpen, ChevronLeft, X, Search } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportStudentListPDF } from '@/lib/pdfExport';
import type { Student } from '@/lib/types';

type EnrichedStudent = Student & { group_name?: string; grade_name?: string; stage_name?: string };

type StudentBreakdownModalProps = {
  open: boolean;
  onClose: () => void;
  allStudents: EnrichedStudent[];
};

type StageKey = string;
type GradeKey = string;

export default function StudentBreakdownModal({ open, onClose, allStudents }: StudentBreakdownModalProps) {
  const [expandedStage, setExpandedStage] = useState<StageKey | null>(null);
  const [expandedGrade, setExpandedGrade] = useState<GradeKey | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const tree = useMemo(() => {
    const stageMap = new Map<string, { name: string; count: number; grades: Map<string, { name: string; count: number; groups: Map<string, { name: string; count: number; students: EnrichedStudent[] }> }> }>();

    for (const s of allStudents) {
      const stageName = s.stage_name ?? 'غير مصنف';
      const gradeName = s.grade_name ?? 'غير مصنف';
      const groupName = s.group_name ?? 'غير مصنف';

      if (!stageMap.has(stageName)) stageMap.set(stageName, { name: stageName, count: 0, grades: new Map() });
      const stage = stageMap.get(stageName)!;
      stage.count++;

      if (!stage.grades.has(gradeName)) stage.grades.set(gradeName, { name: gradeName, count: 0, groups: new Map() });
      const grade = stage.grades.get(gradeName)!;
      grade.count++;

      if (!grade.groups.has(groupName)) grade.groups.set(groupName, { name: groupName, count: 0, students: [] });
      const group = grade.groups.get(groupName)!;
      group.count++;
      group.students.push(s);
    }

    return [...stageMap.values()].sort((a, b) => b.count - a.count);
  }, [allStudents]);

  const filteredStudents = useMemo(() => {
    if (!selectedGroup) return [];
    const groupStudents = tree
      .flatMap((s) => [...s.grades.values()])
      .flatMap((g) => [...g.groups.values()])
      .find((g) => g.name === selectedGroup)?.students ?? [];
    if (!search.trim()) return groupStudents;
    const q = search.trim().toLowerCase();
    return groupStudents.filter((s) => s.name.toLowerCase().includes(q));
  }, [tree, selectedGroup, search]);

  const totalStudents = allStudents.length;

  function handleClose() {
    setExpandedStage(null);
    setExpandedGrade(null);
    setSelectedGroup(null);
    setSearch('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="تفصيل الطلاب حسب المرحلة" size="lg">
      <div className="space-y-3">
        {/* Summary bar */}
        <div className="glass-light rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-emerald-400" />
            <span className="text-sm font-bold text-white">إجمالي الطلاب</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-emerald-400">{totalStudents}</span>
            <PDFButton
              label="تصدير PDF"
              size="sm"
              variant="secondary"
              disabled={allStudents.length === 0}
              onClick={async () => exportStudentListPDF(allStudents, {
                title: 'تفصيل الطلاب حسب المرحلة',
                subtitle: `إجمالي الطلاب: ${totalStudents}`,
              })}
            />
          </div>
        </div>

        {/* Drill-down or student list */}
        <AnimatePresence mode="wait">
          {selectedGroup ? (
            <motion.div
              key="student-list"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setSelectedGroup(null)}
                  className="flex items-center gap-1 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
                >
                  <ChevronLeft size={14} className="rotate-180" />
                  رجوع للمجموعات
                </button>
                <div className="relative flex-1 max-w-xs">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="بحث عن طالب..."
                    className="w-full glass-light rounded-lg py-2 pr-9 pl-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  />
                </div>
              </div>
              <p className="text-xs font-bold text-slate-400">المجموعة: {selectedGroup} — {filteredStudents.length} طالب</p>
              <div className="max-h-64 overflow-y-auto modal-body space-y-1">
                {filteredStudents.length === 0 ? (
                  <p className="text-center text-slate-500 py-4 text-xs">لا يوجد طلاب مطابقون</p>
                ) : (
                  filteredStudents.map((s) => (
                    <div key={s.id} className="glass-light rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{s.name}</span>
                      <span className="text-[10px] text-slate-500">{s.phone ?? '—'}</span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="tree"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {tree.length === 0 ? (
                <p className="text-center text-slate-500 py-8 text-sm">لا توجد بيانات طلاب</p>
              ) : (
                tree.map((stage) => {
                  const stageOpen = expandedStage === stage.name;
                  return (
                    <div key={stage.name} className="glass-light rounded-xl overflow-hidden">
                      <button
                        onClick={() => { setExpandedStage(stageOpen ? null : stage.name); setExpandedGrade(null); }}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition"
                      >
                        <div className="flex items-center gap-2">
                          <ChevronLeft size={16} className={`text-slate-500 transition-transform ${stageOpen ? '-rotate-90' : ''}`} />
                          <GraduationCap size={16} className="text-emerald-400" />
                          <span className="text-sm font-bold text-white">{stage.name}</span>
                        </div>
                        <span className="text-sm font-black text-emerald-400">{stage.count}</span>
                      </button>
                      <AnimatePresence>
                        {stageOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="pr-4 pl-2 pb-2 space-y-1">
                              {[...stage.grades.values()].sort((a, b) => b.count - a.count).map((grade) => {
                                const gradeKey = `${stage.name}__${grade.name}`;
                                const gradeOpen = expandedGrade === gradeKey;
                                return (
                                  <div key={gradeKey}>
                                    <button
                                      onClick={() => setExpandedGrade(gradeOpen ? null : gradeKey)}
                                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 transition"
                                    >
                                      <div className="flex items-center gap-2">
                                        <ChevronLeft size={14} className={`text-slate-600 transition-transform ${gradeOpen ? '-rotate-90' : ''}`} />
                                        <BookOpen size={14} className="text-sky-400" />
                                        <span className="text-xs font-semibold text-slate-300">{grade.name}</span>
                                      </div>
                                      <span className="text-xs font-bold text-slate-400">{grade.count}</span>
                                    </button>
                                    <AnimatePresence>
                                      {gradeOpen && (
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          className="overflow-hidden"
                                        >
                                          <div className="pr-6 space-y-0.5">
                                            {[...grade.groups.values()].sort((a, b) => b.count - a.count).map((group) => (
                                              <button
                                                key={group.name}
                                                onClick={() => setSelectedGroup(group.name)}
                                                className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-emerald-500/10 transition text-right"
                                              >
                                                <div className="flex items-center gap-2">
                                                  <Users size={12} className="text-slate-600" />
                                                  <span className="text-[11px] font-semibold text-slate-400 hover:text-white">{group.name}</span>
                                                </div>
                                                <span className="text-[10px] font-bold text-slate-500">{group.count}</span>
                                              </button>
                                            ))}
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
