import { useState, useMemo } from 'react';
import { ChevronLeft, GraduationCap, BookOpen, UsersRound, Layers } from 'lucide-react';
import type { Group, GradeLevel, AcademicStage } from '@/lib/types';

type EnrichedGroup = Group & {
  grade_level?: { name: string; stage?: { name: string; sort_order: number } } | null;
};

type Props = {
  groups: Group[];
  selectedGroupId: string | null;
  onSelect: (group: Group | null) => void;
  allGroupsEnriched?: EnrichedGroup[];
};

export default function GroupHierarchySelector({ groups, selectedGroupId, onSelect, allGroupsEnriched }: Props) {
  const [selectedStageName, setSelectedStageName] = useState<string | null>(null);
  const [selectedGradeName, setSelectedGradeName] = useState<string | null>(null);

  const tree = useMemo(() => {
    const stageMap = new Map<string, { name: string; sort_order: number; grades: Map<string, { name: string; groups: Group[] }> }>();
    const enrichedMap = new Map<string, EnrichedGroup>();
    if (allGroupsEnriched) {
      for (const e of allGroupsEnriched) enrichedMap.set(e.id, e);
    }
    for (const g of groups) {
      const enriched = enrichedMap.get(g.id);
      const stageName = enriched?.grade_level?.stage?.name ?? 'غير مصنف';
      const stageOrder = enriched?.grade_level?.stage?.sort_order ?? 999;
      const gradeName = enriched?.grade_level?.name ?? 'غير مصنف';
      if (!stageMap.has(stageName)) stageMap.set(stageName, { name: stageName, sort_order: stageOrder, grades: new Map() });
      const stage = stageMap.get(stageName)!;
      if (!stage.grades.has(gradeName)) stage.grades.set(gradeName, { name: gradeName, groups: [] });
      stage.grades.get(gradeName)!.groups.push(g);
    }
    return [...stageMap.values()].sort((a, b) => a.sort_order - b.sort_order);
  }, [groups, allGroupsEnriched]);

  const availableGrades = selectedStageName
    ? tree.find((s) => s.name === selectedStageName)?.grades ?? new Map()
    : new Map<string, { name: string; groups: Group[] }>();

  const availableGroups = selectedStageName && selectedGradeName
    ? availableGrades.get(selectedGradeName)?.groups ?? []
    : [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Stage selector */}
        <div>
          <label className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
            <GraduationCap size={13} className="text-emerald-400" /> المرحلة
          </label>
          <select
            value={selectedStageName ?? ''}
            onChange={(e) => { setSelectedStageName(e.target.value || null); setSelectedGradeName(null); }}
            className="w-full rounded-full py-2.5 px-4 text-sm font-bold text-white bg-slate-800/80 border border-slate-500/50 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition"
          >
            <option value="" className="bg-slate-800 text-white">كل المراحل</option>
            {tree.map((s) => (
              <option key={s.name} value={s.name} className="bg-slate-800 text-white">{s.name}</option>
            ))}
          </select>
        </div>

        {/* Grade selector */}
        <div>
          <label className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
            <BookOpen size={13} className="text-sky-400" /> الصف
          </label>
          <select
            value={selectedGradeName ?? ''}
            onChange={(e) => setSelectedGradeName(e.target.value || null)}
            disabled={!selectedStageName}
            className="w-full rounded-full py-2.5 px-4 text-sm font-bold text-white bg-slate-800/80 border border-slate-500/50 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="" className="bg-slate-800 text-white">كل الصفوف</option>
            {[...availableGrades.values()].map((g) => (
              <option key={g.name} value={g.name} className="bg-slate-800 text-white">{g.name}</option>
            ))}
          </select>
        </div>

        {/* Group selector */}
        <div>
          <label className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
            <UsersRound size={13} className="text-violet-400" /> المجموعة
          </label>
          <select
            value={selectedGroupId ?? ''}
            onChange={(e) => {
              const g = groups.find((x) => x.id === e.target.value);
              onSelect(g ?? null);
            }}
            disabled={!selectedStageName || !selectedGradeName}
            className="w-full rounded-full py-2.5 px-4 text-sm font-bold text-white bg-slate-800/80 border border-slate-500/50 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="" className="bg-slate-800 text-white">كل المجموعات</option>
            {availableGroups.map((g) => (
              <option key={g.id} value={g.id} className="bg-slate-800 text-white">{g.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Active filter pill */}
      {selectedGroupId && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-300">التصفية الحالية:</span>
          {selectedStageName && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">{selectedStageName}</span>}
          {selectedGradeName && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40">{selectedGradeName}</span>}
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/40">
            {groups.find((g) => g.id === selectedGroupId)?.name}
          </span>
          <button
            onClick={() => { setSelectedStageName(null); setSelectedGradeName(null); onSelect(null); }}
            className="text-xs text-red-400 hover:text-red-300 font-bold"
          >
            إلغاء التصفية
          </button>
        </div>
      )}
    </div>
  );
}
