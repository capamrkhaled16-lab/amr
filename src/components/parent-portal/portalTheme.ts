export type PortalTheme = 'light' | 'dark';

export function portalBackground(theme: PortalTheme) {
  return {
    minHeight: '100vh',
    background:
      theme === 'dark'
        ? 'linear-gradient(180deg, #090d0b 0%, #0b0f0e 100%)'
        : 'linear-gradient(160deg, #FBF6E9 0%, #EAF6EF 48%, #E6F2F7 100%)',
  };
}

export const PORTAL_THEME_CSS = String.raw`
.pp-dark { color: #F4F7F4; }
.pp-dark .bg-white, .pp-dark .bg-white\/70, .pp-dark .bg-white\/75, .pp-dark .bg-white\/80, .pp-dark .bg-white\/60 { background-color: rgba(20, 32, 27, 0.82) !important; }
.pp-dark .bg-\[\#F7F8F5\], .pp-dark .bg-\[\#F2F4F1\] { background-color: #101A16 !important; }
.pp-dark .bg-\[\#E8F5EF\] { background-color: #173A2C !important; }
.pp-dark .bg-\[\#FBF3DF\] { background-color: #3A311B !important; }
.pp-dark .bg-\[\#EAF4FC\] { background-color: #172C3A !important; }
.pp-dark .bg-\[\#FEF2F2\] { background-color: #3A1B1B !important; }
.pp-dark .bg-\[\#E6EAE5\] { background-color: #24352D !important; }
.pp-dark .pp-ring-track { stroke: #24352D; }
.pp-dark .border-\[\#E6EAE5\] { border-color: #2B3B34 !important; }
.pp-dark .border-\[\#D8DED9\] { border-color: #405248 !important; }
.pp-dark .text-\[\#24332D\] { color: #F4F7F4 !important; }
.pp-dark .text-\[\#5F6B65\] { color: #B4C2BA !important; }
.pp-dark .text-\[\#77847D\] { color: #91A39A !important; }
.pp-dark .text-\[\#087F5B\] { color: #34D399 !important; }
.pp-dark .text-\[\#8A6A1F\] { color: #E7C65E !important; }
.pp-dark .text-\[\#1D5E8C\] { color: #7DD3FC !important; }
.pp-dark .text-\[\#B91C1C\] { color: #F87171 !important; }
.pp-dark .text-\[\#D9483B\] { color: #F87171 !important; }
.pp-dark nav { background-color: rgba(9, 13, 11, 0.94) !important; }
.pp-aura { background: radial-gradient(circle, rgba(212, 175, 55, 0.28) 0%, rgba(16, 185, 129, 0.12) 45%, transparent 70%); filter: blur(28px); animation: pp-aura 8s ease-in-out infinite; }
.pp-alert { animation: pp-alert 2.4s ease-in-out infinite; }
.pp-flow-border { position: relative; border-color: transparent !important; }
.pp-flow-border::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(120deg, #D4AF37, #10B981, #E7C65E, #059669, #D4AF37);
  background-size: 300% 300%;
  animation: pp-flow 7s linear infinite;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
@keyframes pp-flow {
  0% { background-position: 0% 50%; }
  100% { background-position: 300% 50%; }
}
@keyframes pp-aura {
  0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.7; }
  50% { transform: translateX(-50%) scale(1.12); opacity: 1; }
}
@keyframes pp-alert {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35); }
  50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .pp-aura, .pp-alert, .pp-flow-border::before { animation: none; }
}
`;
