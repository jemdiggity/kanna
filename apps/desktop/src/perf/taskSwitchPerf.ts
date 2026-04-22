export type TaskSwitchPerfPhase = "start" | "terminal-mounted" | "terminal-ready" | "first-output";
export type TaskSwitchPerfMeasure = "total" | "mount" | "ready" | "first-output";
export type TaskSwitchPerfPath = "warm" | "cold" | "unknown";

export interface TaskSwitchPerfRecord {
  switchId: number;
  taskId: string;
  terminalKind: "pty";
  path: TaskSwitchPerfPath;
  startedAt: number;
  marks: Partial<Record<TaskSwitchPerfPhase, number>>;
  measures: Partial<Record<TaskSwitchPerfMeasure, number>>;
  completed: boolean;
}

const MAX_TASK_SWITCH_RECORDS = 10;

let nextSwitchId = 1;
let activeTaskId: string | null = null;
const records: TaskSwitchPerfRecord[] = [];

function appendRecord(record: TaskSwitchPerfRecord): void {
  records.push(record);
  while (records.length > MAX_TASK_SWITCH_RECORDS) {
    records.shift();
  }
}

function getLatestRecordForTask(taskId: string): TaskSwitchPerfRecord | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.taskId === taskId) {
      return record;
    }
  }
  return null;
}

function getMarkName(record: TaskSwitchPerfRecord, phase: TaskSwitchPerfPhase): string {
  return `task-switch:${record.switchId}:${phase}`;
}

function writePhase(record: TaskSwitchPerfRecord, phase: TaskSwitchPerfPhase): boolean {
  if (record.marks[phase] != null) {
    return false;
  }
  const at = performance.now();
  record.marks[phase] = at;
  performance.mark(getMarkName(record, phase));
  return true;
}

function writeMeasure(
  record: TaskSwitchPerfRecord,
  measureName: TaskSwitchPerfMeasure,
  startPhase: TaskSwitchPerfPhase,
  endPhase: TaskSwitchPerfPhase,
): void {
  if (record.measures[measureName] != null) {
    return;
  }
  const start = record.marks[startPhase];
  const end = record.marks[endPhase];
  if (start == null || end == null) {
    return;
  }
  performance.measure(
    `task-switch:${record.switchId}:${measureName}`,
    getMarkName(record, startPhase),
    getMarkName(record, endPhase),
  );
  record.measures[measureName] = end - start;
}

export function beginTaskSwitch(taskId: string): number {
  activeTaskId = taskId;
  const record: TaskSwitchPerfRecord = {
    switchId: nextSwitchId++,
    taskId,
    terminalKind: "pty",
    path: "unknown",
    startedAt: Date.now(),
    marks: {},
    measures: {},
    completed: false,
  };
  appendRecord(record);
  writePhase(record, "start");
  return record.switchId;
}

export function markTaskSwitchMounted(taskId: string): void {
  if (activeTaskId !== taskId) {
    return;
  }
  const record = getLatestRecordForTask(taskId);
  if (!record || record.completed) {
    return;
  }
  if (!writePhase(record, "terminal-mounted")) {
    return;
  }
  writeMeasure(record, "mount", "start", "terminal-mounted");
}

export function markTaskSwitchReady(taskId: string, path: TaskSwitchPerfPath): void {
  if (activeTaskId !== taskId) {
    return;
  }
  const record = getLatestRecordForTask(taskId);
  if (!record || record.completed) {
    return;
  }
  if (record.path === "unknown") {
    record.path = path;
  }
  if (!writePhase(record, "terminal-ready")) {
    return;
  }
  writeMeasure(record, "total", "start", "terminal-ready");
  writeMeasure(record, "ready", "terminal-mounted", "terminal-ready");
  record.completed = true;
}

export function markTaskSwitchFirstOutput(taskId: string): void {
  if (activeTaskId !== taskId) {
    return;
  }
  const record = getLatestRecordForTask(taskId);
  if (!record) {
    return;
  }
  if (!writePhase(record, "first-output")) {
    return;
  }
  writeMeasure(record, "first-output", "start", "first-output");
}

export function getLatestTaskSwitchPerfRecord(): TaskSwitchPerfRecord | null {
  return records.at(-1) ?? null;
}

export function getTaskSwitchPerfRecords(): TaskSwitchPerfRecord[] {
  return [...records];
}

export function clearTaskSwitchPerfRecords(): void {
  records.length = 0;
  nextSwitchId = 1;
  activeTaskId = null;
}
