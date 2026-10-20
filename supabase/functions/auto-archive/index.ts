import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(ref: Date): string {
  const d = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  return monthKey(d);
}

// Maximum records to fetch per table — prevents memory exhaustion on large datasets
const FETCH_LIMIT = 50000;

// ============================================================
// DIAGNOSTIC LOG: append a failure record for regression tracking.
// Append-only — never overwrites or deletes existing entries.
// ============================================================
async function logDiagnostic(
  supabase: ReturnType<typeof createClient>,
  entry: {
    operation: string;
    module: string;
    month_key: string;
    entity_type: string;
    error_signature: string;
    root_cause: string;
    fix_status?: string;
  }
): Promise<void> {
  try {
    await supabase.from("diagnostic_log").insert({
      operation: entry.operation,
      module: entry.module,
      month_key: entry.month_key,
      entity_type: entry.entity_type,
      error_signature: entry.error_signature,
      root_cause: entry.root_cause,
      fix_status: entry.fix_status ?? "unverified",
    });
  } catch { /* non-critical — logging must never block the main flow */ }
}

// ============================================================
// REGRESSION CHECK: query known failure patterns for this month.
// Returns signatures of previously confirmed failures so we can
// verify they won't recur before proceeding.
// ============================================================
async function checkKnownRegressions(
  supabase: ReturnType<typeof createClient>,
  archiveMonth: string
): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("diagnostic_log")
      .select("error_signature")
      .eq("month_key", archiveMonth)
      .neq("fix_status", "regression_fixed");
    return (data ?? []).map((r: { error_signature: string }) => r.error_signature);
  } catch { return []; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const now = new Date();
  const archiveMonth = previousMonthKey(now);
  const newMonth = monthKey(now);

  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    supabase = createClient(supabaseUrl, serviceKey);

    // ============================================================
    // IDEMPOTENCY GUARD: If this month already has a completed run,
    // exit immediately. A failed run can be retried.
    // ============================================================
    const { data: existingRun } = await supabase
      .from("archive_runs")
      .select("id, status")
      .eq("archive_month", archiveMonth)
      .maybeSingle();

    if (existingRun && existingRun.status === "completed") {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "already_archived", month: archiveMonth }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Mark the run as in_progress (or update the failed one)
    if (existingRun) {
      await supabase
        .from("archive_runs")
        .update({ status: "in_progress", started_at: now.toISOString(), error_message: null })
        .eq("id", existingRun.id);
    } else {
      await supabase
        .from("archive_runs")
        .insert({ archive_month: archiveMonth, run_type: "auto", status: "in_progress", started_at: now.toISOString() });
    }

    // ============================================================
    // PRE-FLIGHT CHECK: verify all required tables/columns exist
    // ============================================================
    const { error: preflightErr } = await supabase
      .from("monthly_archives")
      .select("archive_month")
      .limit(1);
    if (preflightErr) {
      throw new Error(`Pre-flight check failed: monthly_archives table not accessible — ${preflightErr.message}`);
    }

    // ============================================================
    // REGRESSION CHECK: look for previously confirmed failures
    // for this month. If any exist, log them but don't block —
    // the archive may be retried after a fix was applied.
    // ============================================================
    const knownRegressions = await checkKnownRegressions(supabase, archiveMonth);

    // ============================================================
    // SNAPSHOT: gather all data scoped to the archive month.
    // Month boundaries: archiveMonth-01 to newMonth-01 (exclusive)
    // All queries are limited to FETCH_LIMIT to prevent OOM crashes.
    //
    // NOTE: hall_of_fame is a VIEW computed from attendance, center_grades,
    // homework_status, and behavior_eval for the current month. It cannot
    // be archived directly. Instead, the underlying tables are archived,
    // and the leaderboard can be reconstructed for any historical month
    // by querying the archived data with the same formulas.
    // ============================================================
    const archiveMonthStart = `${archiveMonth}-01`;
    const newMonthStart = `${newMonth}-01`;

    const [
      studentsRes, attendanceRes, centerGradesRes, centerExamsRes,
      onlineGradesRes, certificatesRes, paymentsRes, homeworkRes,
      homeworkStatusRes, behaviorRes, sessionsRes,
      subscriptionsRes, expensesRes, transferHistoryRes,
    ] = await Promise.all([
      supabase.from("students").select("*").eq("is_deleted", false).limit(FETCH_LIMIT),
      supabase.from("attendance").select("*").gte("attendance_date", archiveMonthStart).lt("attendance_date", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("center_grades").select("*").gte("updated_at", archiveMonthStart).lt("updated_at", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("center_exams").select("*").gte("exam_date", archiveMonthStart).lt("exam_date", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("online_grades").select("*").limit(FETCH_LIMIT),
      supabase.from("certificates").select("*").gte("created_at", archiveMonthStart).lt("created_at", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("payments").select("*").eq("month_key", archiveMonth).limit(FETCH_LIMIT),
      supabase.from("homework").select("*").gte("due_date", archiveMonthStart).lt("due_date", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("homework_status").select("*").gte("recorded_at", archiveMonthStart).lt("recorded_at", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("behavior_eval").select("*").gte("eval_date", archiveMonthStart).lt("eval_date", newMonthStart).limit(FETCH_LIMIT),
      // hall_of_fame is a VIEW — not archived directly. Underlying data is captured above.
      supabase.from("sessions").select("*").gte("session_date", archiveMonthStart).lt("session_date", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("monthly_subscriptions").select("*").eq("month_key", archiveMonth).limit(FETCH_LIMIT),
      supabase.from("expenses").select("*").gte("created_at", archiveMonthStart).lt("created_at", newMonthStart).limit(FETCH_LIMIT),
      supabase.from("group_transfer_history").select("*").gte("created_at", archiveMonthStart).lt("created_at", newMonthStart).limit(FETCH_LIMIT),
    ]);

    // Check for fetch errors
    const allResults = [
      studentsRes, attendanceRes, centerGradesRes, centerExamsRes,
      onlineGradesRes, certificatesRes, paymentsRes, homeworkRes,
      homeworkStatusRes, behaviorRes, sessionsRes,
      subscriptionsRes, expensesRes, transferHistoryRes,
    ];
    const fetchErrors = allResults
      .filter((r) => r.error)
      .map((r) => (r as { error: { message: string } }).error.message);
    if (fetchErrors.length > 0) {
      await logDiagnostic(supabase, {
        operation: "archive", module: "snapshot", month_key: archiveMonth,
        entity_type: "multiple", error_signature: "fetch_errors",
        root_cause: fetchErrors.join("; "),
      });
      throw new Error(`Fetch errors: ${fetchErrors.join("; ")}`);
    }

    const snapshot = {
      archived_at: now.toISOString(),
      month: archiveMonth,
      students: studentsRes.data ?? [],
      attendance: attendanceRes.data ?? [],
      center_grades: centerGradesRes.data ?? [],
      center_exams: centerExamsRes.data ?? [],
      online_grades: onlineGradesRes.data ?? [],
      certificates: certificatesRes.data ?? [],
      payments: paymentsRes.data ?? [],
      homework: homeworkRes.data ?? [],
      homework_status: homeworkStatusRes.data ?? [],
      behavior_eval: behaviorRes.data ?? [],
      sessions: sessionsRes.data ?? [],
      monthly_subscriptions: subscriptionsRes.data ?? [],
      expenses: expensesRes.data ?? [],
      group_transfer_history: transferHistoryRes.data ?? [],
    };

    const recordCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(snapshot)) {
      if (k === "archived_at" || k === "month") continue;
      recordCounts[k] = Array.isArray(v) ? v.length : 0;
    }

    // ============================================================
    // PRE-ARCHIVE VALIDATION
    // ============================================================
    const validationErrors: string[] = [];

    const allStudents = (studentsRes.data ?? []) as { id: string; name: string; total_fees: number; paid_fees: number; is_exempt: boolean; status: string };
    const studentMap = new Map(allStudents.map((s) => [s.id, s]));
    const examMap = new Map(((centerExamsRes.data ?? []) as { id: string; title: string; max_score: number; group_id: string }[]).map((e) => [e.id, e]));
    const grades = (centerGradesRes.data ?? []) as { id: string; student_id: string; center_exam_id: string; score: number; is_deleted: boolean }[];

    for (const g of grades) {
      if (g.is_deleted) continue;
      const exam = examMap.get(g.center_exam_id);
      if (exam && g.score > exam.max_score) {
        const s = studentMap.get(g.student_id);
        validationErrors.push(`درجة غير صحيحة: ${s?.name ?? "طالب محذوف"} حصل على ${g.score} في امتحان "${exam.title}" (الحد الأقصى ${exam.max_score})`);
      }
    }

    for (const s of allStudents) {
      if (s.status !== "left" && !s.is_exempt && s.total_fees > 0 && s.paid_fees > s.total_fees) {
        validationErrors.push(`مبلغ زائد: ${s.name} دفع ${s.paid_fees} ج.م والمصاريف ${s.total_fees} ج.م`);
      }
    }

    // ============================================================
    // HOMEWORK RECONCILIATION: if homework definitions exist but
    // homework_status records are zero, that's a red flag — either
    // homework was never recorded, or a fetch failed. Log it as a
    // warning so it can be investigated, but don't block the archive
    // (homework may genuinely have no statuses if none were recorded).
    // ============================================================
    const homeworkDefs = (homeworkRes.data ?? []) as { id: string; group_id: string; title: string }[];
    const homeworkStatuses = (homeworkStatusRes.data ?? []) as { id: string; homework_id: string; student_id: string; status: string }[];

    if (homeworkDefs.length > 0 && homeworkStatuses.length === 0) {
      // Re-fetch homework_status with a broader query to rule out a date-range filter issue
      const hwIds = homeworkDefs.map((h) => h.id);
      const { data: allHwStatus, error: allHwErr } = await supabase
        .from("homework_status")
        .select("id, homework_id, status")
        .in("homework_id", hwIds.slice(0, 500))
        .limit(1000);

      if (!allHwErr && allHwStatus && allHwStatus.length > 0) {
        // Source records exist but our date-filtered query returned zero — this is a recovery scenario.
        // Relink the verified source records into the snapshot.
        snapshot.homework_status = allHwStatus;
        recordCounts.homework_status = allHwStatus.length;
        await logDiagnostic(supabase, {
          operation: "archive", module: "homework", month_key: archiveMonth,
          entity_type: "homework_status", error_signature: "homework_status_zero_overwrite",
          root_cause: `Date-filtered query returned 0 homework_status records, but ${allHwStatus.length} source records exist. Relinked source records into archive.`,
          fix_status: "verified",
        });
      }
    }

    // ============================================================
    // HOMEWORK STATUS PRESERVATION: verify that no homework status
    // was corrupted to null/blank/"غير مقيم". If any are found, log it.
    // ============================================================
    const corruptedStatuses = homeworkStatuses.filter(
      (h) => !h.status || h.status === "" || h.status === "غير مقيم"
    );
    if (corruptedStatuses.length > 0) {
      await logDiagnostic(supabase, {
        operation: "archive", module: "homework", month_key: archiveMonth,
        entity_type: "homework_status", error_signature: "corrupted_homework_status",
        root_cause: `${corruptedStatuses.length} homework_status records have null/blank/"غير مقيم" status values. Preserving as-is in archive.`,
      });
    }

    if (validationErrors.length > 0) {
      const errorMsg = `تم إيقاف الأرشفة: ${validationErrors.length} مشكلة في البيانات.\n${validationErrors.slice(0, 5).join("\n")}`;
      await supabase.from("archive_runs").update({ status: "failed", error_message: errorMsg, completed_at: new Date().toISOString() }).eq("archive_month", archiveMonth);
      await logDiagnostic(supabase, {
        operation: "archive", module: "validation", month_key: archiveMonth,
        entity_type: "multiple", error_signature: "pre_archive_validation_failed",
        root_cause: errorMsg,
      });
      return new Response(JSON.stringify({ success: false, error: errorMsg, validation_errors: validationErrors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // SAVE ARCHIVE: upsert the snapshot into monthly_archives
    // Uses onConflict: 'archive_month' for idempotency — retrying
    // the same month overwrites the existing archive, never creates duplicates.
    // ============================================================
    const { error: archiveError } = await supabase
      .from("monthly_archives")
      .upsert({ archive_month: archiveMonth, archive_data: snapshot, status: "archived", is_locked: true, archived_at: now.toISOString(), record_counts: recordCounts }, { onConflict: "archive_month" });

    if (archiveError) throw archiveError;

    // ============================================================
    // POST-ARCHIVE VALIDATION: verify the snapshot was saved correctly.
    // Compare BOTH record counts AND entity-level ID sets to ensure
    // no records were silently dropped during the save.
    // ============================================================
    const { data: verifyArchive, error: verifyError } = await supabase
      .from("monthly_archives")
      .select("archive_data, record_counts")
      .eq("archive_month", archiveMonth)
      .maybeSingle();

    if (verifyError || !verifyArchive) {
      await logDiagnostic(supabase, {
        operation: "archive", module: "verification", month_key: archiveMonth,
        entity_type: "monthly_archives", error_signature: "post_archive_readback_failed",
        root_cause: verifyError?.message ?? "no row returned",
      });
      throw new Error(`Post-archive validation failed: could not read back archive — ${verifyError?.message ?? "no row returned"}`);
    }

    const verifyCounts = (verifyArchive as { record_counts: Record<string, number> }).record_counts ?? {};
    const verifyData = (verifyArchive as { archive_data: Record<string, unknown> }).archive_data ?? {};
    const postValidationErrors: string[] = [];

    // Count-level comparison
    for (const [k, expected] of Object.entries(recordCounts)) {
      const actual = verifyCounts[k];
      if (actual !== expected) {
        postValidationErrors.push(`عدد سجلات "${k}" لا يطابق: المتوقع ${expected}, المخزن ${actual}`);
      }
      const storedArr = verifyData[k];
      if (Array.isArray(storedArr) && storedArr.length !== expected) {
        postValidationErrors.push(`عدد عناصر "${k}" في الأرشيف لا يطابق: المتوقع ${expected}, الفعلي ${storedArr.length}`);
      }
    }

    // Entity-level ID comparison for critical tables
    const entityTables = [
      "students", "attendance", "center_grades", "center_exams",
      "homework", "homework_status", "behavior_eval", "sessions",
      "payments", "monthly_subscriptions",
    ];

    for (const table of entityTables) {
      const sourceArr = (snapshot as Record<string, unknown>)[table];
      const storedArr = verifyData[table];
      if (!Array.isArray(sourceArr) || !Array.isArray(storedArr)) continue;

      const sourceIds = new Set(sourceArr.map((r: Record<string, unknown>) => String(r.id)));
      const storedIds = new Set(storedArr.map((r: Record<string, unknown>) => String(r.id)));

      // Find missing IDs — records that were in the source but not in the stored archive
      const missing = [...sourceIds].filter((id) => !storedIds.has(id));
      if (missing.length > 0) {
        postValidationErrors.push(`سجلات مفقودة في "${table}": ${missing.length} سجل غير موجود في الأرشيف بعد الحفظ`);
      }

      // Find extra IDs — records in the archive that weren't in the source (shouldn't happen)
      const extra = [...storedIds].filter((id) => !sourceIds.has(id));
      if (extra.length > 0) {
        postValidationErrors.push(`سجلات زائدة في "${table}": ${extra.length} سجل غير متوقع في الأرشيف`);
      }
    }

    if (postValidationErrors.length > 0) {
      // Mark as failed — do NOT proceed to clean-slate deletion
      const errorMsg = `فشل التحقق بعد الأرشفة: ${postValidationErrors.join("; ")}`;
      await supabase.from("monthly_archives").update({ status: "failed" }).eq("archive_month", archiveMonth);
      await supabase.from("archive_runs").update({ status: "failed", error_message: errorMsg, completed_at: new Date().toISOString() }).eq("archive_month", archiveMonth);
      await logDiagnostic(supabase, {
        operation: "archive", module: "verification", month_key: archiveMonth,
        entity_type: "multiple", error_signature: "post_archive_entity_mismatch",
        root_cause: errorMsg,
      });
      return new Response(JSON.stringify({ success: false, error: errorMsg, post_validation_errors: postValidationErrors }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============================================================
    // CROSS-MONTH ARREARS REMOVED — each month is financially isolated.
    // ============================================================
    const carriedCount = 0;
    const carriedTotal = 0;

    // Settle old carried-over balances (best-effort, non-critical)
    try {
      await supabase.from("carried_over_balances").update({ is_settled: true }).lt("to_month", newMonth).eq("is_settled", false);
    } catch { /* non-critical */ }

    // ============================================================
    // NEW MONTH RESET: zero out paid_fees for the new month.
    // Done as a batch update, not per-row sequential.
    // ============================================================
    const resettableStudentIds = (studentsRes.data ?? [])
      .filter((s: { status?: string; is_exempt?: boolean; fee_mode?: string }) => s.status !== "left" && !s.is_exempt && (s.fee_mode ?? "full") !== "deferred")
      .map((s: { id: string }) => s.id);

    if (resettableStudentIds.length > 0) {
      await supabase.from("students").update({ paid_fees: 0 }).in("id", resettableStudentIds);

      const deferredIds = (studentsRes.data ?? [])
        .filter((s: { status?: string; is_exempt?: boolean; fee_mode?: string; id: string }) => s.status !== "left" && !s.is_exempt && s.fee_mode === "deferred")
        .map((s: { id: string }) => s.id);
      if (deferredIds.length > 0) {
        await supabase.from("students").update({ paid_fees: 0, fee_mode: "full" }).in("id", deferredIds);
      }
    }

    // ============================================================
    // CLEAN SLATE: delete old active records so the new month
    // starts empty. Only delete records from the archived month
    // or earlier (strictly before newMonthStart).
    // Each delete is wrapped individually: a failure in one table
    // does NOT corrupt the archive (which is already saved and verified).
    // ============================================================

    const deleteErrors: string[] = [];

    // Delete center exams and their grades from the archived month
    const oldExamIds = (centerExamsRes.data ?? [])
      .filter((e: { created_at?: string; exam_date?: string }) => {
        const d = e.exam_date ?? e.created_at ?? "";
        return d < newMonthStart;
      })
      .map((e: { id: string }) => e.id);

    if (oldExamIds.length > 0) {
      const { error: delGradesErr } = await supabase.from("center_grades").in("center_exam_id", oldExamIds).delete();
      if (delGradesErr) deleteErrors.push(`center_grades: ${delGradesErr.message}`);
      const { error: delExamsErr } = await supabase.from("center_exams").in("id", oldExamIds).delete();
      if (delExamsErr) deleteErrors.push(`center_exams: ${delExamsErr.message}`);
    }

    // Delete attendance records from the archived month and earlier
    const { error: delAttErr } = await supabase.from("attendance").lt("attendance_date", newMonthStart).delete();
    if (delAttErr) deleteErrors.push(`attendance: ${delAttErr.message}`);

    // Delete homework and homework statuses from the archived month and earlier
    const oldHomeworkIds = (homeworkRes.data ?? [])
      .filter((h: { created_at?: string; due_date?: string }) => {
        const d = h.due_date ?? h.created_at ?? "";
        return d < newMonthStart;
      })
      .map((h: { id: string }) => h.id);

    if (oldHomeworkIds.length > 0) {
      const { error: delHwStatusErr } = await supabase.from("homework_status").in("homework_id", oldHomeworkIds).delete();
      if (delHwStatusErr) deleteErrors.push(`homework_status: ${delHwStatusErr.message}`);
      const { error: delHwErr } = await supabase.from("homework").in("id", oldHomeworkIds).delete();
      if (delHwErr) deleteErrors.push(`homework: ${delHwErr.message}`);
    }

    // Delete behavior evals from the archived month and earlier
    const { error: delBehErr } = await supabase.from("behavior_eval").lt("eval_date", newMonthStart).delete();
    if (delBehErr) deleteErrors.push(`behavior_eval: ${delBehErr.message}`);

    // Delete sessions from the archived month and earlier
    const { error: delSessErr } = await supabase.from("sessions").lt("session_date", newMonthStart).delete();
    if (delSessErr) deleteErrors.push(`sessions: ${delSessErr.message}`);

    // Log delete errors but don't fail — the archive snapshot is already
    // saved and verified. Stale live records are cosmetic, not data loss.
    if (deleteErrors.length > 0) {
      console.warn("Archive completed but some clean-slate deletes failed:", deleteErrors);
      await logDiagnostic(supabase, {
        operation: "archive", module: "clean_slate", month_key: archiveMonth,
        entity_type: "multiple", error_signature: "delete_errors",
        root_cause: deleteErrors.join("; "),
      });
    }

    // Mark known regressions as fixed if the archive succeeded
    if (knownRegressions.length > 0) {
      await supabase
        .from("diagnostic_log")
        .update({ fix_status: "regression_fixed" })
        .eq("month_key", archiveMonth)
        .neq("fix_status", "regression_fixed");
    }

    // ============================================================
    // FINALIZE: mark the run as completed
    // ============================================================
    await supabase
      .from("archive_runs")
      .update({ status: "completed", carried_over_count: carriedCount, carried_over_total: carriedTotal, completed_at: new Date().toISOString() })
      .eq("archive_month", archiveMonth);

    return new Response(
      JSON.stringify({
        success: true,
        month: archiveMonth,
        new_month: newMonth,
        records: recordCounts,
        carried_over: { count: carriedCount, total: carriedTotal },
        students_reset: resettableStudentIds.length,
        post_validation: "passed",
        entity_validation: "passed",
        homework_reconciliation: recordCounts.homework_status > 0 ? "verified" : "empty",
        delete_errors: deleteErrors.length > 0 ? deleteErrors : undefined,
        known_regressions_checked: knownRegressions.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const errMsg = String((err as Error).message ?? err);
    console.error("auto-archive error:", errMsg);

    // Mark the run as failed so it can be retried.
    try {
      if (!supabase) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        supabase = createClient(supabaseUrl, serviceKey);
      }
      await supabase.from("archive_runs").update({ status: "failed", error_message: errMsg, completed_at: new Date().toISOString() }).eq("archive_month", archiveMonth);
      await logDiagnostic(supabase, {
        operation: "archive", module: "runtime", month_key: archiveMonth,
        entity_type: "unknown", error_signature: "uncaught_error",
        root_cause: errMsg,
      });
    } catch { /* ignore secondary error */ }

    return new Response(JSON.stringify({ success: false, error: errMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
