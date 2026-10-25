import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { formatCurrency, getArabicMonth, getMonthKey } from "../lib/dates";
import { deletePaymentWithAudit } from "../lib/data";
import { invalidateByPrefix } from "../lib/cache";
import type { Expense, Group, Payment, Student } from "../lib/types";

type Tab = "payments" | "expenses" | "subscriptions";

export default function Financials() {
  const { showSuccess, showWarning } = useToast();
  const [tab, setTab] = useState<Tab>("payments");
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [search, setSearch] = useState("");
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [saving, setSaving] = useState(false);

  const [paymentForm, setPaymentForm] = useState({
    student_id: "",
    amount: "",
    note: "",
    month_key: getMonthKey(),
  });

  const [expenseForm, setExpenseForm] = useState({
    category: "other",
    amount: "",
    description: "",
    expense_date: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    supabase.from("students").select("*").eq("is_deleted", false).order("name").then(({ data }) => {
      setStudents(data as Student[] || []);
    });
    supabase.from("groups").select("*").order("name").then(({ data }) => {
      setGroups(data as Group[]);
    });
    loadPayments();
    loadExpenses();
  }, []);

  const loadPayments = async () => {
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("is_deleted", false)
      .order("payment_date", { ascending: false })
      .limit(100);
    setPayments(data as Payment[] || []);
  };

  const loadExpenses = async () => {
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("expense_date", { ascending: false })
      .limit(100);
    setExpenses(data as Expense[] || []);
  };

  const studentName = (id: string) => students.find((s) => s.id === id)?.name || "غير معروف";

  const filteredPayments = payments.filter((p) => {
    if (search) return studentName(p.student_id).includes(search);
    return true;
  });

  const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  const handleSavePayment = async () => {
    if (!paymentForm.student_id || !paymentForm.amount || saving) return;
    setSaving(true);

    const idempotencyKey = `${paymentForm.student_id}-${paymentForm.month_key}-${Date.now()}`;

    try {
      const { data, error } = await supabase
        .from("payments")
        .insert({
          student_id: paymentForm.student_id,
          amount: parseFloat(paymentForm.amount),
          note: paymentForm.note || null,
          month_key: paymentForm.month_key,
          payment_date: new Date().toISOString().split("T")[0],
          idempotency_key: idempotencyKey,
        })
        .select()
        .single();

      if (error) throw error;

      const student = students.find((s) => s.id === paymentForm.student_id);
      if (student) {
        await supabase
          .from("students")
          .update({ paid_fees: Number(student.paid_fees) + parseFloat(paymentForm.amount) })
          .eq("id", student.id);
      }

      setPayments((prev) => [data as Payment, ...prev]);
      showSuccess("تم تسجيل الدفعة");
      setPaymentForm({ student_id: "", amount: "", note: "", month_key: getMonthKey() });
      setShowAddPayment(false);
      await loadPayments();
    } catch (err) {
      console.error("[payment] save error:", err);
      showWarning("لم يتم تسجيل الدفعة");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveExpense = async () => {
    if (!expenseForm.amount || saving) return;
    setSaving(true);

    try {
      const { data, error } = await supabase
        .from("expenses")
        .insert({
          category: expenseForm.category,
          amount: parseFloat(expenseForm.amount),
          description: expenseForm.description || null,
          expense_date: expenseForm.expense_date,
        })
        .select()
        .single();

      if (error) throw error;

      setExpenses((prev) => [data as Expense, ...prev]);
      showSuccess("تم تسجيل المصروف");
      setExpenseForm({ category: "other", amount: "", description: "", expense_date: new Date().toISOString().split("T")[0] });
      setShowAddExpense(false);
    } catch (err) {
      console.error("[expense] save error:", err);
      showWarning("لم يتم تسجيل المصروف");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePayment = async (payment: Payment) => {
    if (!confirm("حذف هذه الدفعة؟")) return;
    try {
      await deletePaymentWithAudit(payment.id, "المدرس", "master");
      invalidateByPrefix("students_");
      invalidateByPrefix("payments_");
      invalidateByPrefix("monthly_");
      showSuccess("تم حذف الدفعة");
      await loadPayments();
    } catch (err) {
      showWarning("لم يتم الحذف");
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-sm text-gray-500">إجمالي التحصيل</p>
          <p className="text-xl font-bold text-success-600 mt-1">{formatCurrency(totalPayments)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-sm text-gray-500">إجمالي المصروفات</p>
          <p className="text-xl font-bold text-error-600 mt-1">{formatCurrency(totalExpenses)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-sm text-gray-500">صافي</p>
          <p className="text-xl font-bold text-primary-600 mt-1">{formatCurrency(totalPayments - totalExpenses)}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-2 flex gap-2">
        {([
          { key: "payments", label: "الدفعات" },
          { key: "expenses", label: "المصروفات" },
          { key: "subscriptions", label: "الاشتراكات" },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              tab === t.key ? "bg-primary-600 text-white" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "payments" && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl shadow-sm p-4 flex gap-3 items-center justify-between">
            <input
              type="text"
              placeholder="بحث باسم الطالب..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-300 text-sm flex-1 max-w-xs"
            />
            <button
              onClick={() => setShowAddPayment(!showAddPayment)}
              className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition text-sm font-bold whitespace-nowrap"
            >
              + دفعة جديدة
            </button>
          </div>

          {showAddPayment && (
            <div className="bg-white rounded-2xl shadow-sm p-4 animate-slide-up space-y-3">
              <h3 className="font-bold text-gray-800">تسجيل دفعة</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={paymentForm.student_id}
                  onChange={(e) => setPaymentForm({ ...paymentForm, student_id: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                >
                  <option value="">الطالب *</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="المبلغ *"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                />
                <input
                  type="text"
                  placeholder="ملاحظة"
                  value={paymentForm.note}
                  onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                />
                <input
                  type="month"
                  value={paymentForm.month_key}
                  onChange={(e) => setPaymentForm({ ...paymentForm, month_key: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSavePayment}
                  disabled={saving || !paymentForm.student_id || !paymentForm.amount}
                  className="px-5 py-2.5 bg-success-600 text-white rounded-xl hover:bg-success-700 transition disabled:opacity-60 text-sm font-bold"
                >
                  {saving ? "جاري الحفظ..." : "حفظ"}
                </button>
                <button
                  onClick={() => setShowAddPayment(false)}
                  className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition text-sm font-semibold"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-right p-3 font-semibold text-gray-600">الطالب</th>
                    <th className="text-right p-3 font-semibold text-gray-600">المبلغ</th>
                    <th className="text-right p-3 font-semibold text-gray-600 hidden sm:table-cell">التاريخ</th>
                    <th className="text-right p-3 font-semibold text-gray-600 hidden sm:table-cell">الشهر</th>
                    <th className="text-right p-3 font-semibold text-gray-600">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50 transition">
                      <td className="p-3 font-semibold text-gray-800">{studentName(p.student_id)}</td>
                      <td className="p-3 text-success-600 font-bold">{formatCurrency(Number(p.amount))}</td>
                      <td className="p-3 text-gray-500 hidden sm:table-cell">{p.payment_date}</td>
                      <td className="p-3 text-gray-500 hidden sm:table-cell">{p.month_key || "—"}</td>
                      <td className="p-3">
                        <button
                          onClick={() => handleDeletePayment(p)}
                          className="px-2 py-1 text-xs font-semibold text-error-600 hover:bg-error-50 rounded-lg transition"
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredPayments.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">لا توجد دفعات</div>
            )}
          </div>
        </div>
      )}

      {tab === "expenses" && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl shadow-sm p-4 flex justify-end">
            <button
              onClick={() => setShowAddExpense(!showAddExpense)}
              className="px-4 py-2 bg-error-600 text-white rounded-xl hover:bg-error-700 transition text-sm font-bold"
            >
              + مصروف جديد
            </button>
          </div>

          {showAddExpense && (
            <div className="bg-white rounded-2xl shadow-sm p-4 animate-slide-up space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                >
                  <option value="rent">إيجار</option>
                  <option value="utilities">مرافق</option>
                  <option value="supplies">مستلزمات</option>
                  <option value="salary">مرتبات</option>
                  <option value="other">أخرى</option>
                </select>
                <input
                  type="number"
                  placeholder="المبلغ *"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                />
                <input
                  type="text"
                  placeholder="الوصف"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                />
                <input
                  type="date"
                  value={expenseForm.expense_date}
                  onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                  className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveExpense}
                  disabled={saving || !expenseForm.amount}
                  className="px-5 py-2.5 bg-error-600 text-white rounded-xl hover:bg-error-700 transition disabled:opacity-60 text-sm font-bold"
                >
                  {saving ? "جاري الحفظ..." : "حفظ"}
                </button>
                <button
                  onClick={() => setShowAddExpense(false)}
                  className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition text-sm font-semibold"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-right p-3 font-semibold text-gray-600">التصنيف</th>
                  <th className="text-right p-3 font-semibold text-gray-600">المبلغ</th>
                  <th className="text-right p-3 font-semibold text-gray-600 hidden sm:table-cell">الوصف</th>
                  <th className="text-right p-3 font-semibold text-gray-600">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 transition">
                    <td className="p-3 font-semibold text-gray-700">{e.category}</td>
                    <td className="p-3 text-error-600 font-bold">{formatCurrency(Number(e.amount))}</td>
                    <td className="p-3 text-gray-500 hidden sm:table-cell">{e.description || "—"}</td>
                    <td className="p-3 text-gray-500">{e.expense_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-sm">لا توجد مصروفات</div>
            )}
          </div>
        </div>
      )}

      {tab === "subscriptions" && (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">
          <p>قائمة الاشتراكات الشهرية للطلاب</p>
          <p className="mt-2 text-gray-300">سيتم عرض بيانات الاشتراكات الشهرية هنا</p>
        </div>
      )}
    </div>
  );
}
