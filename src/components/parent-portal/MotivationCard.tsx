import { useState } from 'react';
import { Sparkles, Trophy, Star } from 'lucide-react';

const ENCOURAGEMENT = [
  'ولا يهمك يا بطل، لسه قدامك فرصة كبيرة تتحسن، وأنا مستني أشوف منك نتيجة تفرحك!',
  'أنت تقدر تعمل أحسن من كده، ابدأ خطوة خطوة وركز في اللي جاي، وأنا واثق فيك!',
  'النتيجة دي مش نهاية الطريق، شد حيلك، والشهر الجاي بإذن الله نشوف تقدم يفرحنا!',
];

const POSITIVE = [
  'شاطر يا بطل! مستواك كويس، ومع شوية تركيز هتوصل لمستوى أعلى بكتير!',
  'أنت ماشي في الطريق الصح، كمل واجتهد، ومستني منك نتيجة أقوى المرة الجاية!',
  'تقدم جميل، وعندك فرصة تحقق أكتر. أنا واثق إنك تقدر!',
];

const PRAISE = [
  'برافو عليك يا بطل! مستواك ممتاز، حافظ على قوتك وخلينا نشوف إنجاز أكبر الشهر الجاي!',
  'أداء رائع وتعبك واضح! كمل بنفس الحماس، والقمة مستنياك!',
  'نتيجة تفرح، وفخور باجتهادك. مستني منك الأفضل دايمًا!',
];

const CHAMPION_MESSAGE = 'مليون مبروك يا بطل! جبت الدرجة النهائية 100%، إنجاز يستحق الفخر والتقدير. حافظ على تفوقك، والقمة دايمًا مستنياك!';

interface MotivationCardProps {
  overallPercentage: number;
}

export default function MotivationCard({ overallPercentage }: MotivationCardProps) {
  const [seed] = useState(() => Math.floor(Math.random() * 1000));

  if (overallPercentage >= 100) {
    return (
      <section className="relative overflow-hidden rounded-3xl p-6 border border-amber-300/50 bg-gradient-to-br from-amber-400/20 via-yellow-500/10 to-black/40 shadow-[0_0_40px_rgba(251,191,36,0.25)]">
        <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-amber-400/20 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row items-center gap-5 text-center sm:text-right">
          <div className="shrink-0 w-20 h-20 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-200 via-amber-400 to-yellow-600 shadow-[0_0_30px_rgba(251,191,36,0.6)]">
            <Trophy className="w-10 h-10 text-black" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-widest text-amber-300 mb-1">بطل الشهر — الدرجة الكاملة</p>
            <p className="text-sm sm:text-base text-white leading-relaxed">{CHAMPION_MESSAGE}</p>
          </div>
        </div>
        <div className="relative flex justify-center sm:justify-start gap-1 mt-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="w-4 h-4 text-amber-300 fill-amber-300" />
          ))}
        </div>
      </section>
    );
  }

  const pool = overallPercentage >= 85 ? PRAISE : overallPercentage >= 50 ? POSITIVE : ENCOURAGEMENT;
  const message = pool[seed % pool.length];

  return (
    <section className="pp-glass p-5 flex items-start gap-4">
      <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-400/10 border border-emerald-400/30">
        <Sparkles className="w-5 h-5 text-emerald-300" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-wider text-emerald-300 mb-1">رسالة تشجيع لك</p>
        <p className="text-sm text-white leading-relaxed">{message}</p>
      </div>
    </section>
  );
}
