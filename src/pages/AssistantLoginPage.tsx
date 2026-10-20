import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import LoginLayout, { PinInput, UserInput } from '@/components/auth/LoginLayout';
import Button from '@/components/ui/Button';
import { LogIn } from 'lucide-react';

export default function AssistantLoginPage() {
  const { loginAssistant } = useAuth();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await loginAssistant(username, pin);
      if (!result.ok) {
        setError(result.error ?? 'فشل تسجيل الدخول');
      }
    } catch {
      setError('حدث خطأ غير متوقع. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <LoginLayout
      title="تسجيل دخول المساعد"
      subtitle="بوابة المساعدين — منصة الخالد التعليمية"
      error={error}
      primaryLabel="للمعلم؟"
      primaryHref="/login"
      primaryText="دخول المعلم"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-2">
            رقم المستخدم / الهاتف
          </label>
          <UserInput
            value={username}
            onChange={setUsername}
            placeholder="اسم المستخدم"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-2">
            الرقم السري (PIN)
          </label>
          <PinInput value={pin} onChange={setPin} />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          <LogIn size={18} />
          {loading ? 'جارٍ الدخول...' : 'تسجيل الدخول'}
        </Button>
        <p className="text-xs text-slate-600 text-center">
          جلسات المساعدين دائمة — لا انتهاء للجلسة حتى تسجيل الخروج يدويًا
        </p>
      </form>
    </LoginLayout>
  );
}
