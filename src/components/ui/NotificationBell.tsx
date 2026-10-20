import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, X, Eye, AlertTriangle, CheckCircle2, Info, Trash2, CheckCheck, MoreVertical, FileText } from 'lucide-react';
import { useNotifications, type AppNotification, NOTIFICATION_NAVIGATE_EVENT } from '@/context/NotificationContext';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `قبل ${min} دقيقة`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  const day = Math.floor(hr / 24);
  return `قبل ${day} يوم`;
}

function notifIcon(n: AppNotification) {
  if (n.type === 'success') return <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />;
  if (n.type === 'warning') return <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />;
  if (n.type === 'error') return <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />;
  return <Info size={16} className="text-blue-400 flex-shrink-0" />;
}

function notifBorder(n: AppNotification) {
  if (n.type === 'success') return 'border-emerald-500/30';
  if (n.type === 'warning') return 'border-amber-500/40';
  if (n.type === 'error') return 'border-red-500/40';
  return 'border-blue-500/30';
}

const PANEL_WIDTH = 360;

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead, dismiss, deleteNotification, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [menuForId, setMenuForId] = useState<string | null>(null);
  const [detailForId, setDetailForId] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const top = rect.bottom + 8;
    const maxLeft = Math.max(8, window.innerWidth - PANEL_WIDTH - 8);
    const left = Math.min(rect.left, maxLeft);
    setPanelPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        setOpen(false);
        setMenuForId(null);
        setDetailForId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close any open per-item menu when the panel scrolls
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const onScroll = () => { setMenuForId(null); };
    panel.addEventListener('scroll', onScroll, { passive: true });
    return () => panel.removeEventListener('scroll', onScroll);
  }, [open]);

  const detailNotification = detailForId ? notifications.find((n) => n.id === detailForId) : null;

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={btnRef}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unreadCount > 0) {
            setTimeout(() => markAllRead(), 1000);
          }
        }}
        className="relative p-2 rounded-xl glass-light hover:bg-white/10 text-slate-400 hover:text-white transition flex-shrink-0"
        title="الإشعارات"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center ring-2 ring-slate-900">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && panelPos && (
          <motion.div
            ref={panelRef}
            id="notification-panel"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: PANEL_WIDTH,
              maxWidth: 'calc(100vw - 1rem)',
              zIndex: 99999,
            }}
            className="rounded-2xl border border-white/15 shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header — sticky, solid background */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0"
              style={{ background: 'rgba(15, 23, 42, 0.98)' }}
            >
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <Bell size={14} className="text-emerald-400" />
                الإشعارات
                {unreadCount > 0 && (
                  <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-bold">
                    {unreadCount} جديد
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <>
                    <button
                      onClick={markAllRead}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition"
                      title="تعليم الكل كمقروء"
                    >
                      <CheckCheck size={14} />
                    </button>
                    <button
                      onClick={clearAll}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition"
                      title="مسح الكل"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setOpen(false); setMenuForId(null); setDetailForId(null); }}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* List — solid background, own scroll area */}
            <div
              className="max-h-[420px] overflow-y-auto"
              style={{ background: 'rgba(15, 23, 42, 0.98)' }}
            >
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <Check size={28} className="text-slate-600 mb-2" />
                  <p className="text-xs text-slate-500">لا توجد إشعارات</p>
                </div>
              ) : (
                <div className="space-y-2 p-2.5">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`rounded-xl p-3 border ${notifBorder(n)} ${
                        !n.read ? 'ring-1 ring-emerald-500/20' : ''
                      }`}
                      style={{ background: 'rgba(30, 41, 59, 0.95)' }}
                    >
                      <div className="flex items-start gap-2">
                        {notifIcon(n)}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white leading-snug">{n.title}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{n.message}</p>
                          <p className="text-[9px] text-slate-500 mt-1">{timeAgo(n.createdAt)}</p>
                        </div>
                        <div className="relative flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuForId(menuForId === n.id ? null : n.id);
                            }}
                            className="p-1 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition"
                            title="المزيد"
                          >
                            <MoreVertical size={14} />
                          </button>
                          <AnimatePresence>
                            {menuForId === n.id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                transition={{ duration: 0.1 }}
                                className="absolute left-0 top-7 z-10 w-40 rounded-xl border border-white/15 shadow-2xl overflow-hidden"
                                style={{ background: 'rgba(15, 23, 42, 0.99)' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={() => {
                                    markRead(n.id);
                                    setMenuForId(null);
                                    if (n.actionTarget) {
                                      window.dispatchEvent(new CustomEvent(NOTIFICATION_NAVIGATE_EVENT, { detail: n.actionTarget }));
                                    }
                                    setOpen(false);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/10 transition"
                                >
                                  <Eye size={13} /> عرض التفاصيل
                                </button>
                                <button
                                  onClick={() => {
                                    markRead(n.id);
                                    setMenuForId(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-sky-400 hover:bg-sky-500/10 transition"
                                >
                                  <Check size={13} /> تعليم كمقروء
                                </button>
                                <button
                                  onClick={() => {
                                    dismiss(n.id);
                                    setMenuForId(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/10 transition"
                                >
                                  <X size={13} /> تجاهل
                                </button>
                                <button
                                  onClick={() => {
                                    deleteNotification(n.id);
                                    setMenuForId(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 transition"
                                >
                                  <Trash2 size={13} /> حذف
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        {!n.read && menuForId !== n.id && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 mt-1" />
                        )}
                      </div>
                      {n.actionLabel && menuForId !== n.id && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markRead(n.id);
                              if (n.actionTarget) {
                                window.dispatchEvent(new CustomEvent(NOTIFICATION_NAVIGATE_EVENT, { detail: n.actionTarget }));
                              }
                              setOpen(false);
                            }}
                            className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition px-2 py-1 rounded-lg hover:bg-emerald-500/10 active:scale-95"
                          >
                            <Eye size={12} />
                            {n.actionLabel}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail modal */}
      <AnimatePresence>
        {detailNotification && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
            style={{ zIndex: 100001 }}
            onClick={() => setDetailForId(null)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden pointer-events-auto"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">تفاصيل الإشعار</h3>
                </div>
                <button
                  onClick={() => setDetailForId(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">العنوان</p>
                  <p className="text-sm font-bold text-white">{detailNotification.title}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">التفاصيل</p>
                  <p className="text-sm text-slate-300">{detailNotification.message}</p>
                </div>
                {detailNotification.studentName && (
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">الطالب</p>
                    <p className="text-sm text-white">{detailNotification.studentName}</p>
                  </div>
                )}
                {detailNotification.groupName && (
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">المجموعة</p>
                    <p className="text-sm text-white">{detailNotification.groupName}</p>
                  </div>
                )}
                {detailNotification.sessionDate && (
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">التاريخ</p>
                    <p className="text-sm text-white">{detailNotification.sessionDate}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">وقت الإنشاء</p>
                  <p className="text-sm text-slate-400">{new Date(detailNotification.createdAt).toLocaleString('ar-EG')}</p>
                </div>
                {detailNotification.actionLabel && detailNotification.actionTarget && (
                  <button
                    onClick={() => {
                      markRead(detailNotification.id);
                      window.dispatchEvent(new CustomEvent(NOTIFICATION_NAVIGATE_EVENT, { detail: detailNotification.actionTarget }));
                      setDetailForId(null);
                      setOpen(false);
                    }}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition active:scale-95 flex items-center justify-center gap-2"
                  >
                    <Eye size={15} /> {detailNotification.actionLabel}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
