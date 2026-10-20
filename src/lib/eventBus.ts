type EventMap = {
  'students:changed': { groupId?: string };
  'attendance:changed': { groupId?: string; studentId?: string };
  'payments:changed': { groupId?: string; studentId?: string };
  'grades:changed': { groupId?: string; studentId?: string };
  'homework:changed': { groupId?: string; studentId?: string };
  'behavior:changed': { groupId?: string; studentId?: string };
  'sessions:changed': { groupId?: string };
  'groups:changed': { gradeLevelId?: string };
  'exams:changed': { gradeLevelId?: string };
  'cache:invalidated': { key?: string };
};

type EventName = keyof EventMap;
type Handler<K extends EventName> = (payload: EventMap[K]) => void;

class EventBus {
  private handlers: Map<EventName, Set<Handler<keyof EventMap>>> = new Map();

  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as Handler<keyof EventMap>);
    return () => this.off(event, handler);
  }

  off<K extends EventName>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<keyof EventMap>);
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        (h as Handler<K>)(payload);
      } catch {
        // handler errors must not break the bus
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();

export function emitStudentsChanged(groupId?: string) {
  eventBus.emit('students:changed', { groupId });
}
export function emitAttendanceChanged(groupId?: string, studentId?: string) {
  eventBus.emit('attendance:changed', { groupId, studentId });
}
export function emitPaymentsChanged(groupId?: string, studentId?: string) {
  eventBus.emit('payments:changed', { groupId, studentId });
}
export function emitGradesChanged(groupId?: string, studentId?: string) {
  eventBus.emit('grades:changed', { groupId, studentId });
}
export function emitHomeworkChanged(groupId?: string, studentId?: string) {
  eventBus.emit('homework:changed', { groupId, studentId });
}
export function emitBehaviorChanged(groupId?: string, studentId?: string) {
  eventBus.emit('behavior:changed', { groupId, studentId });
}
export function emitSessionsChanged(groupId?: string) {
  eventBus.emit('sessions:changed', { groupId });
}
export function emitGroupsChanged(gradeLevelId?: string) {
  eventBus.emit('groups:changed', { gradeLevelId });
}
export function emitExamsChanged(gradeLevelId?: string) {
  eventBus.emit('exams:changed', { gradeLevelId });
}
