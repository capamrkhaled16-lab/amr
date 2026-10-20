import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { getArabicMonth, getMonthKey } from "../lib/dates";

interface HallOfFameEntry {
  id: string;
  name: string;
  group_id: string | null;
  group_name: string | null;
  grade_name: string | null;
  stage_name: string | null;
  avg_score: number | null;
  attendance_rate: number | null;
  homework_rate: number | null;
  behavior_score: number | null;
  overall_score: number | null;
}

export default function HallOfFame() {
  const [entries, setEntries] = useState<HallOfFameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthKey, setMonthKey] = useState(getMonthKey());

  useEffect(() => {
    setLoading(true);
    supabase
      .from("hall_of_fame")
      .select("*")
      .order("overall_score", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) {
          console.error("[hall_of_fame] load error:", error.message);
        }
        setEntries(data as HallOfFameEntry[] || []);
        setLoading(false);
      });
  }, [monthKey]);

  const medalColor = (index: number) => {
    if (index === 0) return "from-warning-400 to-warning-600";
    if (index === 1) return "from-gray-300 to-gray-500";
    if (index === 2) return "from-orange-400 to-orange-600";
    return "from-gray-100 to-gray-200";
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-gradient-to-l from-primary-600 to-primary-800 rounded-2xl shadow-lg p-6 text-white">
        <h2 className="text-xl font-bold mb-1">قاعة المشاهير</h2>
        <p className="text-primary-100 text-sm">أفضل الطلاب أداءً - {getArabicMonth()}</p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="inline-block w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">
          لا توجد بيانات متاحة لقاعة المشاهير
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {entries.map((entry, i) => (
            <div
              key={entry.id || i}
              className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition"
            >
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${medalColor(i)} flex items-center justify-center text-white font-bold text-lg flex-shrink-0`}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800 text-sm truncate">{entry.name}</h3>
                <p className="text-gray-400 text-xs">{entry.group_name} - {entry.grade_name}</p>
                <div className="flex gap-3 mt-2 text-xs">
                  {entry.attendance_rate !== null && (
                    <span className="text-success-600">حضور: {Math.round(Number(entry.attendance_rate))}%</span>
                  )}
                  {entry.avg_score !== null && (
                    <span className="text-blue-600">المعدل: {Number(entry.avg_score).toFixed(1)}</span>
                  )}
                </div>
              </div>
              {entry.overall_score !== null && (
                <div className="text-left flex-shrink-0">
                  <p className="text-2xl font-bold text-primary-600">{Number(entry.overall_score).toFixed(1)}</p>
                  <p className="text-xs text-gray-400">المجموع</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
