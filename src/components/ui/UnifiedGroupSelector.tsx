import { useState, useMemo } from 'react';
import { ChevronLeft, GraduationCap, BookOpen, UsersRound, Loader2 } from 'lucide-react';
import type { AcademicStage, GradeLevel, Group } from '@/lib/types';

type Props = {
  stages: AcademicStage[];
  gradeLevels: GradeLevel[];
  groups: Group[];
  groupsLoading: boolean;
  selectedStage: AcademicStage | null;
  selectedGrade: GradeLevel | null;
  selectedGroup: Group | null;
  onSelect: (stage: AcademicStage | null, grade: GradeLevel | null, group: Group | null) => void;
  showStepper?: boolean;
  compact?: boolean;
};

export default function UnifiedGroupSelector({
  stages,
  gradeLevels,
  groups,
  groupsLoading,
  selectedStage,
  selectedGrade,
  selectedGroup,
  onSelect,
  compact = false,
}: Props) {
  const [expandedStage, setExpandedStage] = useState<string | null>(selectedStage?.id ?? null);
  const [expandedGrade, setExpandedGrade] = useState<string | null>(selectedGrade?.id ?? null);

  const filteredGrades = useMemo(
    () => (selectedStage ? gradeLevels.filter((g) => g.stage_id === selectedStage.id) : gradeLevels),
    [gradeLevels, selectedStage],
  );

  const filteredGroups = useMemo(
    () => (selectedGrade ? groups.filter((g) => g.grade_level_id === selectedGrade.id) : groups),
    [groups, selectedGrade],
  );

  if (stages.length === 0 && !groupsLoading) {
    return (
      <div className={`glass-light rounded-xl ${compact ? 'p-3' : 'p-6'} text-center text-slate-400`}>
        <p className="text-sm">لا توجد مراحل دراسية متاحة.</p>
      </div>
    );
  }

  if (groupsLoading) {
    return (
      <div className={`glass-light rounded-xl ${compact ? 'p-3' : 'p-6'} text-center`}>
        <Loader2 size={20} className="animate-spin text-emerald-400 mx-auto mb-2" />
        <p className="text-xs text-slate-400">جارٍ تحميل المجموعات...</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {stages.map((stage) => {
        const isStageExpanded = expandedStage === stage.id;
        const stageGrades = gradeLevels.filter((g) => g.stage_id === stage.id);
        const isSelectedStage = selectedStage?.id === stage.id;

        return (
          <div key={stage.id}>
            <button
              onClick={() => {
                setExpandedStage(isStageExpanded ? null : stage.id);
                if (!isSelectedStage) onSelect(stage, null, null);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold transition ${
                isSelectedStage
                  ? 'bg-emerald-600/15 text-emerald-400'
                  : 'glass-light text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <ChevronLeft
                size={14}
                className={`transition-transform ${isStageExpanded ? '-rotate-90' : ''}`}
              />
              <GraduationCap size={16} />
              <span>{stage.name}</span>
              <span className="text-[10px] text-slate-600 font-normal mr-auto">{stageGrades.length} صفوف</span>
            </button>

            {isStageExpanded && (
              <div className="pr-4 space-y-0.5 mt-0.5">
                {stageGrades.map((grade) => {
                  const isGradeExpanded = expandedGrade === grade.id;
                  const gradeGroups = groups.filter((g) => g.grade_level_id === grade.id);
                  const isSelectedGrade = selectedGrade?.id === grade.id;

                  return (
                    <div key={grade.id}>
                      <button
                        onClick={() => {
                          setExpandedGrade(isGradeExpanded ? null : grade.id);
                          if (!isSelectedGrade) {
                            onSelect(selectedStage?.id === stage.id ? selectedStage : stage, grade, null);
                          }
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition ${
                          isSelectedGrade
                            ? 'bg-sky-600/15 text-sky-400'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <ChevronLeft
                          size={12}
                          className={`transition-transform ${isGradeExpanded ? '-rotate-90' : ''}`}
                        />
                        <BookOpen size={14} />
                        <span>{grade.name}</span>
                        <span className="text-[10px] text-slate-600 font-normal mr-auto">{gradeGroups.length} مجموعات</span>
                      </button>

                      {isGradeExpanded && (
                        <div className="pr-4 space-y-0.5 mt-0.5">
                          {gradeGroups.length === 0 ? (
                            <p className="text-[11px] text-slate-600 px-3 py-1.5">لا توجد مجموعات في هذا الصف.</p>
                          ) : (
                            gradeGroups.map((group) => {
                              const isSelectedGroup = selectedGroup?.id === group.id;
                              return (
                                <button
                                  key={group.id}
                                  onClick={() => {
                                    onSelect(
                                      selectedStage?.id === stage.id ? selectedStage : stage,
                                      grade,
                                      group,
                                    );
                                  }}
                                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${
                                    isSelectedGroup
                                      ? 'bg-emerald-600/20 text-emerald-300'
                                      : 'text-slate-500 hover:text-white hover:bg-white/5'
                                  }`}
                                >
                                  <UsersRound size={12} />
                                  <span>{group.name}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
