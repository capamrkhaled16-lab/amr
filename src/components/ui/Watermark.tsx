import { useSettings } from '@/context/SettingsContext';

export default function Watermark() {
  const { settings } = useSettings();
  return (
    <div
      className="fixed bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-slate-600/40 pointer-events-none select-none z-30 whitespace-nowrap"
    >
      {settings.management_name}
    </div>
  );
}
